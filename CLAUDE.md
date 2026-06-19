# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**ReadWrite** is a web app that scans photos of handwritten or printed notes using Claude's vision API. A single Railway service hosts both the FastAPI backend and static frontend files. Repo: `sapeur49/readwrite`.

---

## Local Development

```bash
pip install -r requirements.txt
ANTHROPIC_API_KEY=sk-... CLERK_JWKS_URL=https://... uvicorn app.main:app --reload
# Open http://localhost:8000
```

No build step. QA is done via `test.html` in the browser (self-contained, no API key needed). Local SQLite DB is auto-created at `readwrite_local.db` when no `DATABASE_URL`/`MYSQL_URL` is set.

**Live state**: `HANDOVER.md` is a session-to-session snapshot (features shipped, open Railway config items, end-to-end checklist). Read it at the start of a new thread to orient quickly.

**Cache busting**: `?v=N` query strings on `app.js` and `style.css` in `index.html`, `results.html`, and `notes.html`. Bump N in all files when deploying JS/CSS changes. Currently at **`v=34`**. (`share.html`, `published.html`, and `settings.html` use absolute paths `/style.css?v=N` and `/app.js?v=N` — update those too.)

---

## Deployment

Push to `main` → Railway auto-deploys (~1-2 min). `Procfile` defines the start command. The `.github/workflows/` files and root `SCAN_ENDPOINT.py` are unused leftovers.

**Git branch workflow**: Always `git fetch origin main` then `git checkout -b <branch> origin/main` before making changes. Apply changes directly on the new branch — never stash/pop across branch switches, as this causes repeated version-number conflicts with squash-merged main.

**Railway env vars required:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint, e.g. `https://<clerk-domain>/.well-known/jwks.json` |
| `CLERK_ISSUER` | Optional — Clerk issuer URL for stricter JWT validation |
| `DATABASE_URL` or `MYSQL_URL` | Full `mysql://user:pass@host:port/db` connection string. Falls back to SQLite if absent/malformed. |
| `VOLUME_PATH` | Path to Railway Volume mount point, e.g. `/data`. Saved file attachments land at `<VOLUME_PATH>/notes/<note_id>/`. |

---

## Architecture

```
app/main.py        FastAPI: POST /api/scan + CRUD /api/notes + publish/share/settings/published routes + static file mount
app/db.py          SQLAlchemy Core persistence — MySQL prod / SQLite dev fallback
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
index.html         Upload UI (sign-in wall + app div + My Notes + Settings links)
results.html       Scan results: image strip, summary, transcription, additional notes, share panel, save/update/delete/publish
notes.html         My Notes list — search, browse, open saved notes (thumbnails + published badge)
share.html         Public share page — no Clerk, loaded from /share/{token}; template/logo from owner settings
settings.html      Settings page — story list title, template, logo, published list visibility (auth'd)
published.html     Public published notes list — /published/{list_token}; template-aware, searchable
app.js             All frontend logic — auth, thumbnails, scan POST, sessionStorage, EXIF display,
                   lightbox carousel, edit, share, notes CRUD, publish/unpublish, initShare(),
                   initSettings(), initPublished()
style.css          Shared styles, CSS variables, auto light/dark mode, 3 share page templates
test.html          Browser-based QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` stays server-side only; never sent to browser
- All files sent in one Claude API call (multipart/form-data); images as `image` blocks, PDFs as `document` blocks
- Client-side image resizing before POST: 150px/JPEG-0.5 thumbnails → `rw_images`, 1500px/JPEG-0.85 lightbox images → `rw_lightbox`, both in `sessionStorage`; PDFs get a placeholder tile
- Results stored as `rw_results` in `sessionStorage`; `results.html` reads and renders them
- Summary and transcription are rendered as HTML via `renderMarkdown()`, not raw text

**sessionStorage keys** (shared contract between `app.js` and `results.html`):
| Key | Contents |
|---|---|
| `rw_images` | JSON array of 150px JPEG data-URLs (thumbnails, one per file) |
| `rw_lightbox` | JSON array of 1500px JPEG data-URLs (full-res, one per file) |
| `rw_results` | JSON object — the full `/api/scan` response (includes `file_exif`) |
| `rw_scan_id` | Saved note ID — set when `results.html?id=…` loads a saved note |

---

## Auth (Clerk — active)

Sign-in is enforced client-side via the Clerk JS SDK loaded from the Clerk domain (not a CDN):
```html
<script src="https://<clerk-domain>/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key="pk_test_..."></script>
```
Using the official Clerk domain (not jsdelivr) is required for Google OAuth to appear.

The scan `fetch` sends `Authorization: Bearer <token>` where token = `await window.Clerk.session.getToken()`. The backend's `require_user` dependency (`app/auth/verify.py`) validates the JWT via JWKS.

**Auth state changes** are handled via `window.Clerk.addListener(({ user }) => ...)` in `initIndex()`. Do not rely solely on a one-time `window.Clerk.user` check.

To update the Clerk publishable key: change `data-clerk-publishable-key` in `index.html`, `results.html`, and `notes.html`.

---

## Backend: app/main.py

- `MODEL` constant selects the Claude model — currently `claude-sonnet-4-6`; `max_tokens=4096`
- `SCAN_PROMPT` controls the Claude prompt. Claude's reply is parsed by extracting the first `{...}` block via regex — the JSON-only output constraint is load-bearing. Prose before/after the JSON breaks parsing silently (returns 502).
- `scanned_at` (ISO-8601 UTC) is added server-side; Claude never generates timestamps.

**EXIF extraction** (`_extract_exif` in `app/main.py`):
- Pillow reads two IFDs: the main IFD (Make, Model) and the ExifIFD sub-IFD via `raw.get_ifd(0x8769)` (DateTimeOriginal, FNumber, ExposureTime, ISOSpeedRatings, LensModel). Shooting data is in the sub-IFD, not the main IFD — this is why both must be read.
- GPS is read via `raw.get_ifd(0x8825)` and included in the response as `{"lat": float, "lon": float}`.
- EXIF (camera, date, GPS) is appended to the Claude prompt as `[Photo metadata: taken {dt}; Camera: {make} {model}; Location: {lat}, {lon}]`. GPS is included so Claude can assist with location-based analysis.
- Scan response includes `file_exif`: array (one entry per file, `null` for PDFs/no-EXIF images).
- EXIF per file is also stored inside the `files` JSON column (as an `exif` key on each file entry) when a note is saved.

**Scan response shape:**
```json
{
  "title": "...", "summary": "...", "transcription": "...",
  "scanned_at": "...",
  "additional_notes": "...",  // only present when `instructions` were provided
  "file_exif": [{"Make": "Apple", "Model": "iPhone 15", "DateTimeOriginal": "2024:03:15 14:22:00",
                  "ISOSpeedRatings": 400, "FNumber": 1.8, "ExposureTime": "1/120",
                  "GPS": {"lat": 48.858, "lon": 2.294}}, null]
}
```

**All API routes** (must be registered before the `StaticFiles` mount):
- `POST /api/scan` — multipart/form-data: `files` + optional `instructions`
- `POST /api/notes` — save a scanned note with file attachments
- `GET /api/notes` — list notes for the signed-in user (supports `?q=` search)
- `GET /api/notes/{id}` — fetch a single note (includes `share_token` field)
- `PUT /api/notes/{id}` — update editable fields: `title`, `summary`, `transcription`, `additional_notes`, `publish_options`
- `DELETE /api/notes/{id}` — delete note + remove volume files
- `GET /api/notes/{id}/files/{position}` — serve an attached file (auth'd)
- `POST /api/notes/{id}/files` — upload additional images/PDFs to a saved note; assigns positions continuing from existing max; extracts EXIF (auth'd)
- `DELETE /api/notes/{id}/files/{position}` — delete a single file from a saved note; removes from disk and updates `files` JSON (auth'd)
- `POST /api/notes/{id}/publish` — generate/return share token (idempotent, auth'd)
- `DELETE /api/notes/{id}/publish` — revoke share token (auth'd)
- `GET /api/settings` — fetch user settings (auth'd)
- `PUT /api/settings` — upsert user settings; auto-generates `list_token` if absent (auth'd)
- `GET /api/share/{token}` — return note JSON + owner settings fields (`template`, `logo_on`, `list_token` if public) (no auth)
- `GET /api/share/{token}/images/{position}` — serve a published note image (no auth)
- `GET /api/published/{list_token}` — return published notes list + settings; 403 if `list_public != true` (no auth)
- `GET /share/{token}` — serve `share.html` (no auth)
- `GET /settings` — serve `settings.html`
- `GET /published/{list_token}` — serve `published.html` (no auth)

---

## Publish / Share

A saved note can be published: `POST /api/notes/{id}/publish` generates a stable UUID share token stored in `notes.share_token`. The share URL is `{origin}/share/{token}`.

`GET /share/{token}` serves `share.html`, which has **absolute** asset paths (`/style.css?v=N`, `/app.js?v=N`) — critical because the URL path `/share/{token}` would make relative paths resolve to `/share/style.css` (404). Same applies to `published.html` and `settings.html`.

`initShare()` in `app.js` fetches `/api/share/{token}`, which now includes the owner's `template`, `logo_on`, and `list_token` (if their published list is public). Template and logo are **global** (from `user_settings`), not per-note. Per-note `publish_options` controls: `showImages`, `showSectionTitles`, `showSummary`, `showTranscription`, `showAdditional`, `imagePosition`, `includeInList`, `excludedImages` (array of positions excluded from the share page).

**Publish panel UX**: When a note is already published, all options are locked/greyed out. "Edit options" button re-enables them, showing "Save options" and "Republish" buttons.

**Published list**: Each user has a stable `list_token` (auto-generated on first settings save). `GET /published/{list_token}` serves the public list page when `list_public = "true"` in `user_settings`. Notes are excluded from the list if `publish_options.includeInList = false`.

**Settings**: Template (minimal/bold/magazine), logo on/off, story list title, and list visibility are global per-user settings stored in `user_settings` table, managed via `/settings` page.

---

## EXIF Display

`addImageTile(thumbSrc, fullSrc, i, exif)` in `app.js` wraps each image in a `<figure class="thumb-figure">` with a `<details class="exif-details">` toggle underneath. The `<dl class="exif-dl">` is **absolute-positioned** (220px wide) so it floats over adjacent thumbnails when opened — `.thumb-figure` has `position: relative` and `:has(details[open])` bumps its `z-index` to 50.

EXIF date format from cameras is `YYYY:MM:DD HH:MM:SS` — `app.js` converts the colons in the date part to dashes before display.

Each tile also renders:
- **Exclude button** (`.pub-exclude-btn`) — toggles the position in the `excludedImages` Set; serialised into `publish_options.excludedImages` on save/publish. Excluded images are hidden on the share page.
- **Delete button** (`.thumb-delete-btn`, saved mode only) — calls `DELETE /api/notes/{id}/files/{position}`, removes the `<figure>` from the DOM immediately.

**Adding images to a saved note**: `enableAddImages(noteId)` in `app.js` shows `#add-images-row` and wires the file input to `POST /api/notes/{id}/files`. A `dataset.wired` guard prevents double-wiring if called more than once. The function is called in two places: in the saved-mode init branch and after a successful save in fresh mode (so the button appears immediately after first save).

---

## Database: app/db.py

SQLAlchemy Core, same code for MySQL (prod) and SQLite (dev). `_migrate_schema()` runs after `create_all()` and adds new columns via `ALTER TABLE` only if absent — works for both engines. Currently migrates: `share_token`, `publish_options` on `notes`.

`files` JSON column stores per-file metadata including `exif` (if available) — no separate EXIF column needed.

`publish_note()` is idempotent: reuses existing token if one already exists.

**`user_settings` table** (new — created via `create_all`, no migration needed):
| Column | Type | Purpose |
|---|---|---|
| `user_id` | String(255) PK | Clerk user sub |
| `story_list_title` | String(512) | Heading on published list page |
| `template` | String(32) | `minimal`\|`bold`\|`magazine` — global for all published pages |
| `logo_on` | String(8) | `"true"`\|`"false"` — show ReadWrite logo on published pages |
| `list_public` | String(8) | `"true"`\|`"false"` — controls public access to published list |
| `list_token` | String(36) | Stable UUID; auto-generated on first `upsert_settings()` call |

Key functions: `get_settings(user_id)`, `upsert_settings(user_id, fields)`, `get_settings_by_list_token(token)`, `list_published_notes(user_id)`, `update_note_files(user_id, note_id, files)`.

---

## Markdown Rendering

`app.js` functions (defined just before the router):

- `escapeHtml(s)` — XSS-safe HTML entity escaping
- `renderMarkdown(text)` — converts `## h2`, `### h3`, `- `/ `* ` lists, `1. ` ordered lists, `**bold**` to HTML; bare `http`/`https` URLs become `<a>` links (via `inlineFormat`); all other content becomes `<p>` wrapped. No external library.
- `setMd(el, text)` — sets `el.innerHTML = renderMarkdown(text)` and stores `el.dataset.rawMd = text`

**Edit mode uses EasyMDE** (loaded from CDN in `results.html`): clicking Edit on Summary/Transcription/Additional Notes opens an EasyMDE instance (toolbar + preview toggle) instead of a plain textarea. Active instances are tracked in the `editors` Map keyed by section name. `getText(section)` queries the live EasyMDE instance if one exists, falling back to `el.dataset.rawMd ?? el.textContent`. Done destroys the EasyMDE instance and re-renders with `setMd()`. Note-title keeps a plain `<input>` (no EasyMDE).

---

## Making Changes

- **Claude prompt / model**: edit `SCAN_PROMPT` / `MODEL` constant in `app/main.py`
- **EXIF fields extracted**: edit `_extract_exif()` in `app/main.py`
- **Styling**: CSS variables at top of `style.css`
- **Markdown rendering**: edit `renderMarkdown()` in `app.js`
- **Share checkboxes** (title/date/images/summary/transcription/additional notes): `#share-card` in `results.html`; the `#share-btn` handler in `app.js` assembles checked sections and calls `share()`; additional notes only added to output when non-empty
- **Publish options** (per-note): `#publish-card` in `results.html`; `getPublishOptions()`/`restorePublishOptions()` in `app.js`; stored in `notes.publish_options` JSON column. `savePublishOptions()` sends both text fields and publish_options together so title/summary edits are never lost when using publish actions.
- **Image exclude/delete per tile**: `addImageTile()` in `app.js` — Exclude button toggles `excludedImages` Set; Delete button calls `DELETE /api/notes/{id}/files/{position}` (saved mode only)
- **Add images to saved note**: `enableAddImages(noteId)` in `app.js` — call after save or on saved-mode load; uses `dataset.wired` guard to prevent double-wiring
- **Global settings** (template/logo/list title): `settings.html` + `initSettings()` in `app.js`; stored in `user_settings` table via `PUT /api/settings`
- **DB schema changes on `notes`**: add column to `notes` Table in `app/db.py` AND add an `ALTER TABLE` guard in `_migrate_schema()`. New tables: just add to `metadata` — `create_all()` handles them automatically.
- **Tests**: add blocks inside `runTests()` in `test.html`

---

## Multi-Utility Platform

Auth is live. For future utilities: each gets its own repo + Railway service, sharing the same Clerk app (same `CLERK_PUBLISHABLE_KEY` / `CLERK_JWKS_URL`). Copy `app/auth/verify.py` into each service. The `AUTH_HANDOFF.md` in this repo has the full pattern.
