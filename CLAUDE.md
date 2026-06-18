# CLAUDE.md

Guidance for Claude Code working in this repo. These instructions override default behavior.

## What This Is
**ReadWrite** — web app that scans photos of handwritten/printed notes via Claude's vision
API. One Railway service hosts the FastAPI backend + static frontend. Repo: `sapeur49/readwrite`.

## Current State (continuity)
- **Saved-notes feature** (MySQL persistence + Railway volume, Save/My Notes/edit/delete)
  is complete on branch **`claude/beautiful-cerf-86quxm`** — **not yet merged to `main`**,
  so it is **not live** yet.
- **Pending Railway setup** before/at merge:
  1. Set `DATABASE_URL` on the ReadWrite service → reference the existing MySQL service
     (`${{MySQL.MYSQL_URL}}` or `${{MySQL.DATABASE_URL}}`). App accepts `MYSQL_URL` too.
  2. Add a **Volume** mounted at `/data`; set `VOLUME_PATH=/data`.
  3. Tables auto-create on startup (`db.init_db()`); no manual SQL required.
- To deploy/test the branch first: Railway service → Settings → Source → point at the
  branch, verify, then switch back to `main` and merge. Env vars live on the service, so
  they persist across the branch switch.
- **Cache-buster currently `?v=15`** on `app.js`/`style.css` in index/results/notes.html.

## Local Development
```bash
pip install -r requirements.txt
ANTHROPIC_API_KEY=sk-... CLERK_JWKS_URL=https://... uvicorn app.main:app --reload
# http://localhost:8000  (no DATABASE_URL → SQLite file; set VOLUME_PATH to a local dir)
```
No build step. No test runner — QA via `test.html` in the browser.
**Cache busting**: bump `?v=N` on `app.js`/`style.css` in index.html, results.html,
notes.html when deploying JS/CSS changes.

## Deployment
Push to `main` → Railway auto-deploys (~1-2 min) via `Procfile`. The `.github/workflows/`
files and root `SCAN_ENDPOINT.py` are unused leftovers — harmless.

**Railway env vars:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (server-side only; never sent to browser) |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint |
| `CLERK_ISSUER` | Optional — stricter JWT validation |
| `DATABASE_URL` | MySQL (also accepts `MYSQL_URL`); `mysql://`→`mysql+pymysql://` auto. Unset → SQLite dev file |
| `VOLUME_PATH` | Railway volume mount for saved files; default `/data`. Files at `<VOLUME_PATH>/notes/<id>/` |

## Architecture
```
app/main.py        FastAPI: /api/scan, /api/notes CRUD + file serving, static mount
app/db.py          SQLAlchemy Core persistence (MySQL prod / SQLite dev) — notes table
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
index.html         Upload UI (sign-in wall + app); "My Notes" button
results.html       Results / saved-note view: images, summary, transcription, share, Save/Update/Delete
notes.html         "My Notes" list (search + rows → results.html?id=…)
app.js             All frontend logic — auth, scan, sessionStorage, IndexedDB, lightbox, edit, share, notes CRUD
style.css          Shared styles, CSS vars, auto light/dark
test.html          Browser QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` server-side only.
- All files sent in one Claude call; images as `image` blocks, PDFs as `document` blocks.
- Client resizes images before POST: 150px/JPEG-0.5 thumbs → `rw_images`,
  1500px/JPEG-0.85 → `rw_lightbox` (both sessionStorage); PDFs get a placeholder tile.
- Results in `rw_results` (sessionStorage); `results.html` renders them.
- `SCAN_URL = '/api/scan'` — relative, same origin.

**Saved notes:**
- One `notes` table (`app/db.py`): text columns + `files` JSON
  (`[{position, kind, filename, mime, original_name}]`), scoped by `user_id` = Clerk `sub`.
  Tables auto-create on startup; every query filters by `user_id`.
- Files persist on the Railway volume under `<VOLUME_PATH>/notes/<note_id>/`; images as the
  browser's 1500px JPEGs, PDFs as original bytes. No server-side image processing.
- **Save carries blobs via IndexedDB**: scan-time `app.js` stashes 1500px blobs + PDF files
  in IndexedDB (`readwrite`/`pending`, keyed by `scanId` in sessionStorage); Save reads
  them back and POSTs. Nothing persists until Save.
- **Images served auth'd**: `<img>` can't send a bearer token, so saved view fetches each
  file via `GET /api/notes/{id}/files/{position}` and renders `URL.createObjectURL(blob)`.
- `results.html` two modes: fresh scan (sessionStorage → **Save**) and saved (`?id=` →
  **Update**/**Delete**) — same render/edit/share path.

## Auth (Clerk)
Client-side sign-in via Clerk JS SDK loaded from the **Clerk domain** (not a CDN — required
for Google OAuth). Scan/notes `fetch` send `Authorization: Bearer <token>` where token =
`await window.Clerk.session.getToken()`; backend `require_user` (`app/auth/verify.py`)
validates via JWKS. Ensure `window.Clerk.session` is non-null before `getToken()`.
To change the publishable key: edit `data-clerk-publishable-key` in index.html,
results.html, notes.html.

## Backend (app/main.py)
- `POST /api/scan` — multipart: `files` (+ optional `instructions`).
- `MODEL` constant selects the Claude model (`claude-sonnet-4-6`); `max_tokens=4096`.
- `SCAN_PROMPT` controls the prompt; reply parsed by extracting first `{...}` + `json.loads`
  (JSON-only output is load-bearing).
- `instructions` non-empty → Claude also returns `additional_notes`.
- `scanned_at` (ISO-8601 UTC) added server-side after parsing.
- Static mounted at `/` via `StaticFiles(directory=".", html=True)` — after API routes.
- Notes endpoints (all `Depends(require_user)`, filtered by `sub`): `POST /api/notes`
  (multipart: `note` JSON + `files` + `files_meta`), `GET /api/notes?q=`,
  `GET/PUT/DELETE /api/notes/{id}`, `GET /api/notes/{id}/files/{position}`.
  `PUT` edits text fields only — images/PDFs immutable in v1.

## Making Changes
- **Prompt**: `SCAN_PROMPT` in app/main.py · **Model**: `MODEL` in app/main.py
- **Styling**: CSS vars atop style.css
- **Share**: `#share-card` in results.html with per-section checkboxes; `#share-btn` in app.js
- **Tests**: blocks inside `runTests()` in test.html

## Future
See `AUTH_HANDOFF.md`: each future utility gets its own repo + Railway service, sharing the
same Clerk app. Copy `app/auth/verify.py` into each service.
