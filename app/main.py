import base64
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import List

import anthropic
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    from PIL import Image as _PILImage
    from PIL.ExifTags import GPSTAGS as _GPSTAGS, TAGS as _EXIF_TAGS
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

from app import db
from app.auth.verify import verify_clerk_token

VOLUME_PATH = Path(os.environ.get("VOLUME_PATH", "/data"))
NOTES_DIR = VOLUME_PATH / "notes"

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")) if os.environ.get("ANTHROPIC_API_KEY") else None

SCAN_PROMPT = """You are processing scanned note images. For each image provided:
1. Transcribe ALL visible text accurately. Mirror the structure of the original:
   - Use `## Heading` for any section headings or titled sections in the notes
   - Use `- item` for bullet or list items that appear as such in the original
   - Use `1. item` for numbered lists
   - Use `**term**` to bold key terms, headings within paragraphs, or important phrases
   - Separate distinct sections or paragraphs with a blank line
   - Write prose as flowing prose — do NOT wrap at arbitrary line lengths
2. Produce a concise summary (under 200 words) highlighting key points and action items. Use markdown formatting where it aids clarity: `## ` for major themes, `- ` for action items or key points, `**bold**` for critical terms.
3. Create a short descriptive title (max ~8 words) capturing the note's subject — plain text, no markdown.

Respond with ONLY valid JSON in this exact shape:
{
  "title": "a short descriptive title (max ~8 words) capturing the note's subject",
  "summary": "concise markdown-formatted summary with key points and action items, under 200 words",
  "transcription": "full verbatim transcription using markdown to reflect the original structure"
}"""

app = FastAPI()


def _parse_gps(gps_ifd: dict):
    try:
        gps = {_GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}

        def dms_to_decimal(vals, ref):
            d, m, s = [float(v) for v in vals]
            dec = d + m / 60 + s / 3600
            return -dec if ref in ("S", "W") else dec

        lat = dms_to_decimal(gps["GPSLatitude"], gps.get("GPSLatitudeRef", "N"))
        lon = dms_to_decimal(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
        return {"lat": round(lat, 6), "lon": round(lon, 6)}
    except Exception:
        return None


def _extract_exif(data: bytes, mime_type: str):
    """Return a dict of EXIF fields of interest, or None if unavailable."""
    if not _PIL_AVAILABLE or not mime_type.startswith("image/"):
        return None
    try:
        img = _PILImage.open(BytesIO(data))
        raw = img.getexif()
        if not raw:
            return None

        # Main IFD: Make, Model
        main_tags = {_EXIF_TAGS.get(k, k): v for k, v in raw.items()}
        result = {}
        for field in ("Make", "Model"):
            if field in main_tags:
                result[field] = str(main_tags[field]).strip("\x00").strip()

        # ExifIFD sub-IFD (0x8769): shooting data not present in main IFD
        try:
            exif_ifd = raw.get_ifd(0x8769)
            if exif_ifd:
                exif_tags = {_EXIF_TAGS.get(k, k): v for k, v in exif_ifd.items()}
                for field in ("DateTimeOriginal", "DateTimeDigitized", "LensModel"):
                    if field in exif_tags and field not in result:
                        result[field] = str(exif_tags[field]).strip("\x00").strip()
                if "ISOSpeedRatings" not in result and "ISOSpeedRatings" in exif_tags:
                    try:
                        result["ISOSpeedRatings"] = int(exif_tags["ISOSpeedRatings"])
                    except (TypeError, ValueError):
                        pass
                if "FNumber" not in result and "FNumber" in exif_tags:
                    try:
                        result["FNumber"] = round(float(exif_tags["FNumber"]), 1)
                    except (TypeError, ValueError):
                        pass
                if "ExposureTime" not in result and "ExposureTime" in exif_tags:
                    try:
                        v = float(exif_tags["ExposureTime"])
                        result["ExposureTime"] = f"1/{round(1/v)}" if 0 < v < 1 else f"{v}s"
                    except (TypeError, ValueError, ZeroDivisionError):
                        pass
        except Exception:
            pass

        # Fall back to DateTime from main IFD if no DateTimeOriginal
        if "DateTimeOriginal" not in result and "DateTime" in main_tags:
            result["DateTime"] = str(main_tags["DateTime"]).strip("\x00").strip()

        # GPS sub-IFD (0x8825)
        try:
            gps_ifd = raw.get_ifd(0x8825)
            if gps_ifd:
                gps = _parse_gps(dict(gps_ifd))
                if gps:
                    result["GPS"] = gps
        except Exception:
            pass

        return result if result else None
    except Exception:
        return None


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

    # Read all files upfront so EXIF can be extracted before encoding
    file_data = []
    file_exif_list = []
    for f in files:
        data = await f.read()
        mime = f.content_type or "image/jpeg"
        file_data.append((data, mime))
        file_exif_list.append(_extract_exif(data, mime))

    image_blocks = []
    for data, media_type in file_data:
        b64 = base64.b64encode(data).decode()
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

    # Append camera/date/location context from first image with EXIF
    for ex in file_exif_list:
        if ex:
            parts = []
            dt = ex.get("DateTimeOriginal") or ex.get("DateTimeDigitized") or ex.get("DateTime")
            if dt:
                parts.append(f"taken {dt}")
            camera = " ".join(filter(None, [ex.get("Make", "").strip(), ex.get("Model", "").strip()]))
            if camera:
                parts.append(f"Camera: {camera}")
            gps = ex.get("GPS")
            if gps:
                parts.append(f"Location: {gps['lat']}, {gps['lon']}")
            if parts:
                prompt += f"\n\n[Photo metadata: {'; '.join(parts)}]"
            break

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
    result["file_exif"] = file_exif_list
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
        entry = {
            "position": position,
            "kind": kind,
            "filename": filename,
            "mime": f.content_type or ("application/pdf" if kind == "pdf" else "image/jpeg"),
            "original_name": m.get("original_name"),
        }
        if m.get("exif"):
            entry["exif"] = m["exif"]
        stored.append(entry)

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


# ── Publish / share ──────────────────────────────────────────────────────────

@app.post("/api/notes/{note_id}/publish")
def publish_note_route(note_id: str, _user: dict = Depends(require_user)):
    token = db.publish_note(_user["sub"], note_id)
    if token is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"share_token": token}


@app.delete("/api/notes/{note_id}/publish")
def unpublish_note_route(note_id: str, _user: dict = Depends(require_user)):
    found = db.unpublish_note(_user["sub"], note_id)
    if not found:
        raise HTTPException(status_code=404, detail="Note not found")
    return {}


@app.get("/api/settings")
def get_settings_route(_user: dict = Depends(require_user)):
    return db.get_settings(_user["sub"])


@app.put("/api/settings")
def update_settings_route(payload: dict = Body(...), _user: dict = Depends(require_user)):
    return db.upsert_settings(_user["sub"], payload)


@app.get("/api/published/{list_token}")
def get_published_list(list_token: str):
    settings = db.get_settings_by_list_token(list_token)
    if not settings:
        raise HTTPException(status_code=404, detail="Not found")
    if settings.get("list_public") != "true":
        raise HTTPException(status_code=403, detail="This list is private")
    notes_list = db.list_published_notes(settings["user_id"])
    return {
        "settings": {
            "storyListTitle": settings.get("story_list_title") or "",
            "template": settings.get("template") or "minimal",
            "logoOn": settings.get("logo_on") == "true",
            "listToken": list_token,
        },
        "notes": notes_list,
    }


@app.get("/settings", include_in_schema=False)
def settings_page():
    path = Path("settings.html")
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


@app.get("/published/{list_token}", include_in_schema=False)
def published_page_route(list_token: str):
    path = Path("published.html")
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


@app.get("/share/{token}", include_in_schema=False)
def share_page_route(token: str):
    path = Path("share.html")
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


@app.get("/api/share/{token}")
def share_data_route(token: str, authorization: str = Header(default="")):
    note = db.get_note_by_share_token(token)
    if not note:
        raise HTTPException(status_code=404, detail="Note not published or not found")
    vis = (note.get("visibility") or "public").strip()
    if vis in ("logged_in", "me"):
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail={"visibility": vis})
        try:
            req_user = verify_clerk_token(authorization[7:])
        except Exception:
            raise HTTPException(status_code=401, detail={"visibility": vis})
        if vis == "me" and req_user["sub"] != note.get("user_id"):
            raise HTTPException(status_code=403, detail="Access denied")
    user_id = note.pop("user_id", None)
    note.pop("share_token", None)
    note.pop("is_published", None)
    if user_id:
        owner_settings = db.get_settings(user_id)
        note["template"] = owner_settings.get("template") or "minimal"
        note["logo_on"] = owner_settings.get("logo_on") == "true"
        note["story_list_title"] = owner_settings.get("story_list_title") or ""
        if owner_settings.get("list_public") == "true" and owner_settings.get("list_token"):
            note["list_token"] = owner_settings["list_token"]
            adj = db.get_adjacent_published_notes(user_id, note["id"])
            note["prev_token"] = adj["prev_token"]
            note["next_token"] = adj["next_token"]
    return note


@app.get("/api/share/{token}/images/{position}")
def share_note_image(token: str, position: int, authorization: str = Header(default="")):
    note = db.get_note_by_share_token(token)
    if not note:
        raise HTTPException(status_code=404, detail="Not found")
    vis = (note.get("visibility") or "public").strip()
    if vis in ("logged_in", "me"):
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail={"visibility": vis})
        try:
            req_user = verify_clerk_token(authorization[7:])
        except Exception:
            raise HTTPException(status_code=401, detail={"visibility": vis})
        if vis == "me" and req_user["sub"] != note.get("user_id"):
            raise HTTPException(status_code=403, detail="Access denied")
    entry = next(
        (f for f in note.get("files", []) if int(f.get("position", -1)) == position and f.get("kind") == "image"),
        None,
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Not found")
    path = NOTES_DIR / note["id"] / entry["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type=entry.get("mime", "image/jpeg"))


@app.delete("/api/notes/{note_id}/files/{position}")
async def delete_note_file(note_id: str, position: int, _user: dict = Depends(require_user)):
    note = db.get_note(_user["sub"], note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    existing = note.get("files") or []
    entry = next((f for f in existing if int(f.get("position", -1)) == position), None)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found")
    path = NOTES_DIR / note_id / entry["filename"]
    path.unlink(missing_ok=True)
    updated = [f for f in existing if int(f.get("position", -1)) != position]
    db.update_note_files(_user["sub"], note_id, updated)
    return {"ok": True}


@app.post("/api/notes/{note_id}/files")
async def add_note_files(
    note_id: str,
    files: List[UploadFile] = File(...),
    _user: dict = Depends(require_user),
):
    note = db.get_note(_user["sub"], note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    existing = note.get("files") or []
    next_pos = max((int(f["position"]) for f in existing), default=-1) + 1

    folder = NOTES_DIR / note_id
    folder.mkdir(parents=True, exist_ok=True)

    new_entries = []
    for i, f in enumerate(files):
        data = await f.read()
        mime = f.content_type or "image/jpeg"
        kind = "pdf" if mime == "application/pdf" else "image"
        position = next_pos + i
        ext = _EXT.get(kind, ".bin")
        filename = f"{position}{ext}"
        (folder / filename).write_bytes(data)
        entry = {
            "position": position,
            "kind": kind,
            "filename": filename,
            "mime": mime,
            "original_name": f.filename,
        }
        exif = _extract_exif(data, mime)
        if exif:
            entry["exif"] = exif
        new_entries.append(entry)

    db.update_note_files(_user["sub"], note_id, existing + new_entries)
    return {"added": len(new_entries), "files": new_entries}


# Serve static frontend — must come after API routes
app.mount("/", StaticFiles(directory=".", html=True), name="static")
