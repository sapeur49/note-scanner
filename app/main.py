import base64
import hashlib
import html as _html
import json
import os
import re
import secrets
import shutil
import uuid
from datetime import date as _date, datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import List

import anthropic
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
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

SCAN_PROMPT_BASE = """You are processing images submitted for scanning and analysis. For each image, first determine whether it is primarily text-based (handwritten or printed notes, documents) or primarily visual (photograph, object, scene, diagram).

**If primarily TEXT (notes, documents):**
1. Transcribe ALL visible text accurately, mirroring the original structure:
   - Use `## Heading` for section headings or titled sections
   - Use `- item` for bullet or list items
   - Use `1. item` for numbered lists
   - Use `**term**` to bold key terms or important phrases
   - Separate distinct sections with a blank line
   - Write prose as flowing prose — do NOT wrap at arbitrary line lengths
2. Produce a concise summary (under 200 words) of key points and action items, using markdown where helpful.
3. Create a short descriptive title (max ~8 words) — plain text, no markdown.

**If primarily VISUAL (photo, object, scene, diagram):**
1. In "transcription": include any visible text, labels, numbers, or markings present in the image (empty string if none).
2. In "summary": provide a detailed analytical description — identify the subject, describe what is depicted, note relevant details, context, and any meaningful observations.
3. Create a short descriptive title (max ~8 words) capturing the subject — plain text, no markdown.

**Web search:** If the scanned content references information that may be time-sensitive or could have changed since your training — such as current events, news, prices, scores, currently-serving officials, recent research, upcoming events, or anything where giving an outdated answer would be misleading or unhelpful — use web search to verify or supplement your response before finalising it. If the content is purely personal notes, creative writing, historical context, or anything not time-sensitive, transcribe and analyse normally without searching.

**Citation format:** When you draw on web search results, do NOT insert source links inline within body text. Write all prose naturally with no links, bracketed citations, or superscripts interrupting sentences. At the very end of the `additional_notes` field only, if web search was used, append a `### Sources` section listing each source actually referenced, one per line as a bare markdown link — never write `([Name](url))`, only `[Name](url)`:

### Sources
- [Source Name](https://real-url-from-search-result)

Omit the `### Sources` section entirely if no web search was used. Never add a Sources section to `summary` or `transcription`. Use only real URLs from the search results — never fabricate a URL. Your entire response must be clean text and markdown only, with no XML, HTML, or `<cite>` tags of any kind.

**Do not narrate your research process.** Never say things like "web searches confirm", "multiple outlets verify", "I searched for", or describe the act of looking something up. State facts directly as if you already knew them."""

SCAN_PROMPT_JSON_SHAPE = """

Respond with ONLY valid JSON in this exact shape:
{
  "title": "a short descriptive title (max ~8 words)",
  "summary": "concise markdown-formatted summary or visual description",
  "transcription": "full text transcription, or empty string if no significant text"
}"""

SCAN_PROMPT = SCAN_PROMPT_BASE + SCAN_PROMPT_JSON_SHAPE

app = FastAPI()


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    if "text/html" in response.headers.get("content-type", ""):
        response.headers["Cache-Control"] = "no-cache"
    return response


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


def _hash_access_code(code: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt.encode(), 100_000)
    return f"pbkdf2:{salt}:{dk.hex()}"


def _verify_access_code(code: str, stored_hash: str) -> bool:
    try:
        algo, salt, hex_dk = stored_hash.split(":", 2)
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt.encode(), 100_000)
        return secrets.compare_digest(dk.hex(), hex_dk)
    except Exception:
        return False


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
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 files per scan")

    user_id = _user["sub"]
    today_str = _date.today().strftime("%Y-%m-%d")
    per_user_limit = int(db.get_global_setting("per_user_daily_limit") or "30")
    global_limit = int(db.get_global_setting("global_daily_limit") or "500")
    user_count, global_count = db.get_scan_counts(user_id, today_str)
    if global_count >= global_limit:
        raise HTTPException(status_code=429, detail="ReadWrite has reached its scan limit for today. Please try again tomorrow.")
    if user_count >= per_user_limit:
        raise HTTPException(status_code=429, detail="You've reached your daily scan limit. Please try again tomorrow.")

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

    user_settings_row = db.get_settings(_user["sub"])
    custom_prompt = (user_settings_row.get("scan_prompt") or "").strip()
    # Always append JSON shape so custom prompts can't break parsing
    prompt = (custom_prompt if custom_prompt else SCAN_PROMPT_BASE) + SCAN_PROMPT_JSON_SHAPE
    if instructions and instructions.strip():
        prompt += f"""\n\nAdditional instructions: {instructions.strip()}

Include an "additional_notes" key in your JSON response addressing the additional instructions above. The "summary" field must remain solely a summary of the scanned content itself — do NOT place any response to the additional instructions into "summary". All content generated in response to the additional instructions, including any web-searched context, goes exclusively into "additional_notes". Omit "additional_notes" entirely if no additional instructions were given."""

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

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            messages=[{"role": "user", "content": image_blocks}],
        )
    except anthropic.BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"Images could not be processed: {e.message}")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Claude API rate limit reached. Please try again shortly.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach Claude API. Please try again.")

    # Web search responses may include non-text blocks (tool_use, tool_result);
    # extract the last text block which contains the final JSON output.
    text_blocks = [b for b in response.content if getattr(b, "type", None) == "text"]
    raw = text_blocks[-1].text if text_blocks else ""
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(status_code=502, detail="Unexpected response from Claude")

    result = json.loads(match.group())
    result["scanned_at"] = datetime.now(timezone.utc).isoformat()
    result["file_exif"] = file_exif_list
    db.increment_scan_count(user_id, today_str)
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
def list_notes(q: str = "", notebook_id: str = "", _user: dict = Depends(require_user)):
    return db.list_notes(_user["sub"], q.strip(), notebook_id.strip())


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
    result = db.publish_note(_user["sub"], note_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return result  # {"share_token": ..., "slug": ...}


@app.delete("/api/notes/{note_id}/publish")
def unpublish_note_route(note_id: str, _user: dict = Depends(require_user)):
    found = db.unpublish_note(_user["sub"], note_id)
    if not found:
        raise HTTPException(status_code=404, detail="Note not found")
    return {}


@app.get("/api/default-scan-prompt")
def get_default_scan_prompt(_user: dict = Depends(require_user)):
    return {"prompt": SCAN_PROMPT_BASE + SCAN_PROMPT_JSON_SHAPE}


@app.get("/api/admin/scan-limits")
def get_scan_limits(_user: dict = Depends(require_user)):
    return {
        "per_user_daily_limit": int(db.get_global_setting("per_user_daily_limit") or "30"),
        "global_daily_limit": int(db.get_global_setting("global_daily_limit") or "500"),
    }


@app.put("/api/admin/scan-limits")
def update_scan_limits(payload: dict = Body(...), _user: dict = Depends(require_user)):
    per_user = payload.get("per_user_daily_limit")
    global_v = payload.get("global_daily_limit")
    if per_user is not None:
        db.set_global_setting("per_user_daily_limit", str(int(per_user)))
    if global_v is not None:
        db.set_global_setting("global_daily_limit", str(int(global_v)))
    return {"ok": True}


@app.get("/api/settings")
def get_settings_route(_user: dict = Depends(require_user)):
    return db.get_settings(_user["sub"])


@app.put("/api/settings")
def update_settings_route(payload: dict = Body(...), _user: dict = Depends(require_user)):
    return db.upsert_settings(_user["sub"], payload)


@app.get("/api/published/{identifier}")
def get_published_list(
    identifier: str,
    nb: str = "",
    authorization: str = Header(default=""),
    x_notebook_access_code: str = Header(default="", alias="x-notebook-access-code"),
):
    # Try as list_token UUID first; if not found, try as a notebook slug globally
    active_notebook = None
    notebook_via_slug = False
    settings = db.get_settings_by_list_token(identifier)
    if not settings:
        # Try global notebook slug lookup
        nb_row = db.get_notebook_by_global_slug(identifier)
        if not nb_row:
            raise HTTPException(status_code=404, detail="Not found")
        settings = db.get_settings(nb_row["user_id"])
        if not settings or settings.get("list_public") != "true":
            raise HTTPException(status_code=404, detail="Not found")
        active_notebook = {"id": nb_row["id"], "title": nb_row["title"], "slug": nb_row["slug"], "visibility": nb_row.get("visibility") or "public"}
        notebook_via_slug = True
        # Enforce access code when set on this notebook
        nb_code_hash = nb_row.get("access_code_hash")
        if nb_code_hash:
            if not x_notebook_access_code or not _verify_access_code(x_notebook_access_code, nb_code_hash):
                raise HTTPException(status_code=403, detail="access_code_required")
    else:
        if settings.get("list_public") != "true":
            raise HTTPException(status_code=403, detail="This list is private")

    is_owner = False
    is_authenticated = False
    if authorization.startswith("Bearer "):
        try:
            req_user = verify_clerk_token(authorization[7:])
            is_owner = req_user["sub"] == settings["user_id"]
            is_authenticated = True
        except Exception:
            pass

    # Enforce notebook visibility for slug-resolved notebooks
    if notebook_via_slug and active_notebook:
        nb_vis = active_notebook.get("visibility") or "public"
        if nb_vis == "me" and not is_owner:
            raise HTTPException(status_code=403, detail="private")
        if nb_vis == "logged_in" and not is_authenticated:
            raise HTTPException(status_code=403, detail="login_required")

    # Resolve optional ?nb= slug filter (when using UUID list_token URL)
    if nb and not active_notebook:
        active_notebook = db.get_notebook_by_slug(settings["user_id"], nb)

    # Fetch notes with appropriate includeIn* filter
    is_notebook_view = active_notebook is not None
    notes_list = db.list_published_notes(settings["user_id"], for_notebook=is_notebook_view)

    if not is_owner:
        allowed = {"public", "logged_in"} if is_authenticated else {"public"}
        notes_list = [n for n in notes_list if (n.get("visibility") or "public") in allowed]

    # Server-side filter notes to notebook when active_notebook is set
    if active_notebook:
        nb_id = active_notebook["id"]
        notes_list = [n for n in notes_list if nb_id in (n.get("notebook_ids") or [])]

    pub_notebooks = db.list_published_notebooks(settings["user_id"])
    return {
        "settings": {
            "storyListTitle": settings.get("story_list_title") or "",
            "template": settings.get("template") or "minimal",
            "logoOn": settings.get("logo_on") == "true",
            "listToken": settings.get("list_token") or identifier,
            "isOwner": is_owner,
            "showNotebookFilter": settings.get("show_notebook_filter") == "true",
        },
        "notes": notes_list,
        "notebooks": pub_notebooks,
        "activeNotebook": active_notebook,
    }


@app.get("/api/notebooks")
def list_notebooks_route(_user: dict = Depends(require_user)):
    return db.list_notebooks(_user["sub"])


@app.post("/api/notebooks")
def create_notebook_route(payload: dict = Body(...), _user: dict = Depends(require_user)):
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    return db.create_notebook(_user["sub"], title)


@app.put("/api/notebooks/{notebook_id}")
def update_notebook_route(notebook_id: str, payload: dict = Body(...), _user: dict = Depends(require_user)):
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    slug = payload.get("slug")  # None = auto-derive from title
    visibility = payload.get("visibility")  # None = leave unchanged
    if not db.update_notebook(_user["sub"], notebook_id, title, slug=slug, visibility=visibility):
        raise HTTPException(status_code=404, detail="Notebook not found")
    # Handle access code — only present in payload when user is actively setting/clearing it
    if "access_code" in payload:
        code = (payload.get("access_code") or "").strip()
        code_hash = _hash_access_code(code) if code else None
        db.set_notebook_access_code(_user["sub"], notebook_id, code_hash, code_plain=code or None)
    nbs = db.list_notebooks(_user["sub"])
    nb = next((n for n in nbs if n["id"] == notebook_id), None)
    return nb or {"ok": True}


@app.delete("/api/notebooks/{notebook_id}")
def delete_notebook_route(notebook_id: str, _user: dict = Depends(require_user)):
    if not db.delete_notebook(_user["sub"], notebook_id):
        raise HTTPException(status_code=404, detail="Notebook not found")
    return {"ok": True}


@app.put("/api/notes/{note_id}/notebooks")
def set_note_notebooks_route(note_id: str, payload: dict = Body(...), _user: dict = Depends(require_user)):
    notebook_ids = payload.get("notebook_ids") or []
    if not db.set_note_notebooks(_user["sub"], note_id, notebook_ids):
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


@app.get("/help", include_in_schema=False)
def help_page():
    path = Path("help.html")
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


@app.get("/notebooks", include_in_schema=False)
def notebooks_page():
    path = Path("notebooks.html")
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(str(path))


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
def share_page_route(token: str, request: Request):
    path = Path("share.html")
    if not path.exists():
        raise HTTPException(status_code=404)

    page = path.read_text(encoding="utf-8")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    origin = f"{proto}://{host}"

    note = db.get_note_by_share_token(token) or db.get_note_by_slug(token)

    if note and note.get("is_published"):
        vis = (note.get("visibility") or "public").strip()
        if vis == "public":
            og_title = note.get("title") or "ReadWrite"
            raw = note.get("summary") or ""
            og_desc = re.sub(r"\s+", " ", re.sub(r"[#*_`\[\]()>~]", "", raw)).strip()[:160]
            pub_opts = note.get("publish_options") or {}
            excluded = set(pub_opts.get("excludedImages") or [])
            files = note.get("files") or []
            first_img = next(
                (f for f in files if f.get("kind") == "image" and f.get("position") not in excluded),
                None,
            ) if pub_opts.get("showImages", True) else None
            og_image = f"{origin}/api/share/{token}/images/{first_img['position']}" if first_img else ""
            og_url = f"{origin}/share/{note.get('slug') or token}"
        else:
            og_title = "ReadWrite"
            og_desc = "Sign in to view this note."
            og_image = ""
            og_url = f"{origin}/share/{token}"
    else:
        og_title = "ReadWrite"
        og_desc = "Scan and share your handwritten notes."
        og_image = ""
        og_url = f"{origin}/share/{token}"

    et = _html.escape(og_title, quote=True)
    ed = _html.escape(og_desc, quote=True)
    eu = _html.escape(og_url, quote=True)
    ei = _html.escape(og_image, quote=True)
    card = "summary_large_image" if og_image else "summary"
    img_meta = f'\n  <meta property="og:image" content="{ei}">\n  <meta name="twitter:image" content="{ei}">' if og_image else ""

    meta_block = (
        f'  <meta property="og:type" content="article">\n'
        f'  <meta property="og:site_name" content="ReadWrite">\n'
        f'  <meta property="og:title" content="{et}">\n'
        f'  <meta property="og:description" content="{ed}">\n'
        f'  <meta property="og:url" content="{eu}">{img_meta}\n'
        f'  <meta name="twitter:card" content="{card}">\n'
        f'  <meta name="twitter:title" content="{et}">\n'
        f'  <meta name="twitter:description" content="{ed}">\n'
    )

    page = page.replace("</head>", meta_block + "</head>", 1)
    if og_title != "ReadWrite":
        page = page.replace(
            "<title>ReadWrite</title>",
            f"<title>{_html.escape(og_title)} — ReadWrite</title>",
            1,
        )

    return HTMLResponse(content=page)


@app.get("/api/share/{token}")
def share_data_route(token: str, authorization: str = Header(default="")):
    note = db.get_note_by_share_token(token) or db.get_note_by_slug(token)
    if not note:
        raise HTTPException(status_code=404, detail="Note not published or not found")
    vis = (note.get("visibility") or "public").strip()
    req_user = None
    if vis in ("logged_in", "me"):
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail={"visibility": vis})
        try:
            req_user = verify_clerk_token(authorization[7:])
        except Exception:
            raise HTTPException(status_code=401, detail={"visibility": vis})
        if vis == "me" and req_user["sub"] != note.get("user_id"):
            raise HTTPException(status_code=403, detail="Access denied")
    elif authorization.startswith("Bearer "):
        try:
            req_user = verify_clerk_token(authorization[7:])
        except Exception:
            pass
    user_id = note.pop("user_id", None)
    note.pop("share_token", None)
    note.pop("is_published", None)
    if req_user and req_user.get("sub") == user_id:
        note["is_owner"] = True
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
    note = db.get_note_by_share_token(token) or db.get_note_by_slug(token)
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
