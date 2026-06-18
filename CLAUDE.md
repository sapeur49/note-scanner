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

No build step. No test runner — QA is done via `test.html` in the browser (self-contained, no API key needed).

**Cache busting**: `?v=N` query strings on `app.js` and `style.css` in both `index.html` and `results.html`. Bump N in both files when deploying JS/CSS changes.

---

## Deployment

Push to `main` → Railway auto-deploys (~1-2 min). `Procfile` defines the start command (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`). The `.github/workflows/` files and the root `SCAN_ENDPOINT.py` (a paste-in snippet authored for a different repo) are unused leftovers — harmless, not wired into anything.

**Railway env vars required:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint, e.g. `https://<clerk-domain>/.well-known/jwks.json` |
| `CLERK_ISSUER` | Optional — Clerk issuer URL for stricter JWT validation |
| `DATABASE_URL` | MySQL connection (saved notes). Also accepts `MYSQL_URL`. `mysql://` is auto-rewritten to `mysql+pymysql://`. Unset → local SQLite file (`readwrite_local.db`) for dev |
| `VOLUME_PATH` | Mount path of the Railway volume for saved note files; default `/data`. Files live under `<VOLUME_PATH>/notes/<note_id>/` |

---

## Architecture

```
app/main.py        FastAPI: /api/scan, /api/notes CRUD + file serving, static mount
app/db.py          SQLAlchemy Core persistence (MySQL prod / SQLite dev) — notes table
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
index.html         Upload UI (sign-in wall + app div); "My Notes" button
results.html       Results/saved-note view: image strip, summary, transcription, share, Save/Update/Delete
notes.html         "My Notes" list page (search + rows linking to results.html?id=…)
app.js             All frontend logic — auth, scan, sessionStorage, IndexedDB, lightbox, edit, share, notes CRUD
style.css          Shared styles, CSS variables, auto light/dark mode
test.html          Browser-based QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` stays server-side only; never sent to browser
- All files sent in one Claude API call (multipart/form-data); images as `image` blocks, PDFs as `document` blocks
- Client-side image resizing before POST: 150px/JPEG-0.5 thumbnails → `rw_images`, 1500px/JPEG-0.85 lightbox images → `rw_lightbox`, both in `sessionStorage`; PDFs get a placeholder tile (no client-side render)
- Results stored as `rw_results` in `sessionStorage`; `results.html` reads and renders them
- `SCAN_URL = '/api/scan'` is relative — same origin, no hardcoded domain

**Saved notes (persistence):**
- One `notes` table (`app/db.py`): text columns + a `files` JSON column (`[{position, kind, filename, mime, original_name}]`), scoped by `user_id` = Clerk `sub`. Tables auto-create on startup (`db.init_db()`); every query filters by `user_id` for isolation
- Files persist on the Railway **volume** under `<VOLUME_PATH>/notes/<note_id>/`; images stored as the browser's 1500px JPEGs, PDFs as original bytes. No server-side image processing
- **Save carries blobs via IndexedDB**: at scan time `app.js` stashes 1500px image blobs + original PDF files in IndexedDB (`readwrite`/`pending`, keyed by a `scanId` in `sessionStorage`) because `results.html` is a separate page; the Save button reads them back and POSTs. Nothing persists until Save
- **Images served auth'd**: `<img>` can't send a bearer token, so `results.html?id=…` fetches each file via `GET /api/notes/{id}/files/{position}` with the token and renders `URL.createObjectURL(blob)` into the existing strip/lightbox
- `results.html` has two modes: fresh scan (reads `sessionStorage`, shows **Save**) and saved (`?id=`, fetches the note, shows **Update**/**Delete**) — same render/edit/share code path

---

## Auth (Clerk — active)

Sign-in is enforced client-side via the Clerk JS SDK loaded from the Clerk domain (not a CDN):
```html
<script src="https://<clerk-domain>/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key="pk_test_..."></script>
```
Using the official Clerk domain (not jsdelivr) is required for Google OAuth to appear.

The scan `fetch` sends `Authorization: Bearer <token>` where token = `await window.Clerk.session.getToken()`. The backend's `require_user` dependency (`app/auth/verify.py`) validates the JWT via JWKS. Ensure `window.Clerk.session` is non-null before calling `getToken()` — null means the user isn't signed in.

To update the Clerk publishable key: change `data-clerk-publishable-key` in both `index.html` and `results.html`.

---

## Backend: app/main.py

- `POST /api/scan` — multipart/form-data: `files` (images/PDFs) + optional `instructions` string
- `MODEL` constant (top of `app/main.py`) selects the Claude model — currently `claude-sonnet-4-6`; `max_tokens=4096`
- `SCAN_PROMPT` constant controls the Claude prompt; edit it there to change transcription/summary behaviour
- Claude's reply is parsed by extracting the first `{...}` block via regex, then `json.loads` — the prompt forcing JSON-only output is load-bearing
- When `instructions` is non-empty, Claude also returns `additional_notes` in the JSON response
- `scanned_at` (ISO-8601 UTC) is added server-side after parsing Claude's reply — Claude never generates the timestamp (no clock); the frontend formats it friendly per locale
- Response shape: `{"title": "...", "summary": "...", "transcription": "...", "scanned_at": "...", "additional_notes": "..."}` (`additional_notes` omitted when no instructions)
- Static files mounted at `/` via `StaticFiles(directory=".", html=True)` — must come after API routes
- Saved-note endpoints (all `Depends(require_user)`, filtered by `sub`): `POST /api/notes` (multipart: `note` JSON + `files` + `files_meta`), `GET /api/notes?q=` (list/full-content search), `GET/PUT/DELETE /api/notes/{id}`, `GET /api/notes/{id}/files/{position}` (auth'd file stream). `PUT` edits text fields only — images/PDFs are immutable in v1

---

## Making Changes

- **Claude prompt**: edit `SCAN_PROMPT` in `app/main.py`
- **Claude model**: edit the `MODEL` constant in `app/main.py`
- **Styling**: CSS variables at top of `style.css`
- **Share**: single Share panel (`#share-card` in `results.html`) with per-section checkboxes (title/date/image/summary/transcription); the `#share-btn` handler in `app.js` assembles checked sections and calls `share()`
- **Tests**: add blocks inside `runTests()` in `test.html`

---

## Future Auth / Multi-Utility Platform

See `AUTH_HANDOFF.md` for the full architecture plan. Summary: each future utility gets its own repo + Railway service, all sharing the same Clerk app. Copy `app/auth/verify.py` into each service.
