import base64
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import anthropic
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import db
from app.auth.verify import verify_clerk_token

VOLUME_PATH = Path(os.environ.get("VOLUME_PATH", "/data"))
NOTES_DIR = VOLUME_PATH / "notes"

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")) if os.environ.get("ANTHROPIC_API_KEY") else None

SCAN_PROMPT = """You are processing scanned note images. For each image provided:
1. Transcribe ALL visible text. Use paragraph breaks between distinct sections. Use bullet points only where the original notes use them. Do NOT wrap text at arbitrary line lengths — write flowing prose where the original is prose.
2. Produce a concise summary highlighting key points and any action items. Keep the summary under 200 words.
3. Create a short descriptive title (max ~8 words) capturing the note's subject.

Respond with ONLY valid JSON in this exact shape:
{
  "title": "a short descriptive title (max ~8 words) capturing the note's subject",
  "summary": "concise summary with key points and action items, under 200 words",
  "transcription": "full verbatim transcription of all text across all images"
}"""

app = FastAPI()

try:
    db.init_db()
except Exception as e:  # noqa: BLE001 — don't block static serving if DB is unreachable
    print(f"[db] init failed: {e}")


def require_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    try:
        return verify_clerk_token(authorization[7:])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


@app.post("/api/scan")
async def scan_notes(
    files: List[UploadFile] = File(...),
    instructions: str = Form(default=""),
    _user: dict = Depends(require_user),
):
    if not client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    if not files:
        raise HTTPException(status_code=400, detail="No images provided")

    image_blocks = []
    for f in files:
        data = await f.read()
        b64 = base64.b64encode(data).decode()
        media_type = f.content_type or "image/jpeg"
        if media_type == "application/pdf":
            image_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
            })
        else:
            image_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })

    prompt = SCAN_PROMPT
    if instructions and instructions.strip():
        prompt += f"""\n\nAdditional instructions: {instructions.strip()}

Also include an "additional_notes" key in your JSON response addressing the additional instructions above. Omit "additional_notes" entirely if no additional instructions were given."""
    image_blocks.append({"type": "text", "text": prompt})

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": image_blocks}],
    )

    raw = response.content[0].text
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(status_code=502, detail="Unexpected response from Claude")

    result = json.loads(match.group())
    result["scanned_at"] = datetime.now(timezone.utc).isoformat()
    return result


# ── Saved notes ──────────────────────────────────────────────────────────────

_EXT = {"image": ".jpg", "pdf": ".pdf"}


@app.post("/api/notes")
async def save_note(
    note: str = Form(...),
    files_meta: str = Form(default="[]"),
    files: List[UploadFile] = File(default=[]),
    _user: dict = Depends(require_user),
):
    user_id = _user["sub"]
    note_data = json.loads(note)
    meta = json.loads(files_meta)

    note_id = str(uuid.uuid4())
    folder = NOTES_DIR / note_id
    folder.mkdir(parents=True, exist_ok=True)

    stored = []
    for i, f in enumerate(files):
        m = meta[i] if i < len(meta) else {}
        kind = m.get("kind", "image")
        position = m.get("position", i)
        ext = _EXT.get(kind, ".bin")
        filename = f"{position}{ext}"
        data = await f.read()
        (folder / filename).write_bytes(data)
        stored.append({
            "position": position,
            "kind": kind,
            "filename": filename,
            "mime": f.content_type or ("application/pdf" if kind == "pdf" else "image/jpeg"),
            "original_name": m.get("original_name"),
        })

    db.create_note(user_id, note_data, stored, note_id=note_id)
    return {"id": note_id}


@app.get("/api/notes")
def list_notes(q: str = "", _user: dict = Depends(require_user)):
    return db.list_notes(_user["sub"], q.strip())


@app.get("/api/notes/{note_id}")
def get_note(note_id: str, _user: dict = Depends(require_user)):
    note = db.get_note(_user["sub"], note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@app.put("/api/notes/{note_id}")
def update_note(note_id: str, payload: dict = Body(...), _user: dict = Depends(require_user)):
    updated = db.update_note(_user["sub"], note_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str, _user: dict = Depends(require_user)):
    note = db.get_note(_user["sub"], note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete_note(_user["sub"], note_id)
    shutil.rmtree(NOTES_DIR / note_id, ignore_errors=True)
    return {"ok": True}


@app.get("/api/notes/{note_id}/files/{position}")
def get_note_file(note_id: str, position: int, _user: dict = Depends(require_user)):
    note = db.get_note(_user["sub"], note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    entry = next((f for f in note.get("files", []) if int(f.get("position")) == position), None)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found")
    path = NOTES_DIR / note_id / entry["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type=entry.get("mime", "application/octet-stream"))


# Serve static frontend — must come after API routes
app.mount("/", StaticFiles(directory=".", html=True), name="static")
