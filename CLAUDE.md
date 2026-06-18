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

**Cache busting**: `?v=N` query strings on `app.js` and `style.css` in `index.html`, `results.html`, and `notes.html`. Bump N in all three files when deploying JS/CSS changes. Currently at `v=18`.

---

## Deployment

Push to `main` → Railway auto-deploys (~1-2 min). `Procfile` defines the start command (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`). The `.github/workflows/` files and the root `SCAN_ENDPOINT.py` (a paste-in snippet authored for a different repo) are unused leftovers — harmless, not wired into anything.

**Railway env vars required:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint, e.g. `https://<clerk-domain>/.well-known/jwks.json` |
| `CLERK_ISSUER` | Optional — Clerk issuer URL for stricter JWT validation |
| `DATABASE_URL` or `MYSQL_URL` | Full `mysql://user:pass@host:port/db` connection string. If absent or malformed, falls back to SQLite (notes won't persist across redeploys). |
| `VOLUME_PATH` | Path to Railway Volume mount point, e.g. `/data`. Saved file attachments land at `<VOLUME_PATH>/notes/<note_id>/`. |

---

## Architecture

```
app/main.py        FastAPI: POST /api/scan + CRUD /api/notes + static file mount
app/db.py          SQLAlchemy Core persistence — MySQL prod / SQLite dev fallback
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
index.html         Upload UI (sign-in wall + app div, shown/hidden by Clerk JS)
results.html       Results: image strip, summary, transcription, share, save/update/delete, export PDF
notes.html         My Notes list — search, browse, open saved notes
app.js             All frontend logic — auth, thumbnails, scan POST, sessionStorage, lightbox, edit, share, notes CRUD
style.css          Shared styles, CSS variables, auto light/dark mode, @media print
test.html          Browser-based QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` stays server-side only; never sent to browser
- All files sent in one Claude API call (multipart/form-data); images as `image` blocks, PDFs as `document` blocks
- Client-side image resizing before POST: 150px/JPEG-0.5 thumbnails → `rw_images`, 1500px/JPEG-0.85 lightbox images → `rw_lightbox`, both in `sessionStorage`; PDFs get a placeholder tile (no client-side render)
- Results stored as `rw_results` in `sessionStorage`; `results.html` reads and renders them
- `SCAN_URL = '/api/scan'` is relative — same origin, no hardcoded domain
- Summary and transcription are rendered as HTML via `renderMarkdown()` (see below), not raw text

**sessionStorage keys** (shared contract between `app.js` and `results.html`):
| Key | Contents |
|---|---|
| `rw_images` | JSON array of 150px JPEG data-URLs (thumbnails, one per file) |
| `rw_lightbox` | JSON array of 1500px JPEG data-URLs (full-res, one per file) |
| `rw_results` | JSON object — the full `/api/scan` response |
| `rw_scan_id` | Saved note ID — set when `results.html?id=…` loads a saved note (distinguishes fresh-scan vs saved-note mode) |

---

## Auth (Clerk — active)

Sign-in is enforced client-side via the Clerk JS SDK loaded from the Clerk domain (not a CDN):
```html
<script src="https://<clerk-domain>/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key="pk_test_..."></script>
```
Using the official Clerk domain (not jsdelivr) is required for Google OAuth to appear.

The scan `fetch` sends `Authorization: Bearer <token>` where token = `await window.Clerk.session.getToken()`. The backend's `require_user` dependency (`app/auth/verify.py`) validates the JWT via JWKS. Ensure `window.Clerk.session` is non-null before calling `getToken()` — null means the user isn't signed in.

**Auth state changes** are handled via `window.Clerk.addListener(({ user }) => ...)` in `initIndex()`. This covers the initial load, sign-in after sign-out (without a page reload), and session expiry. Do not rely solely on a one-time `window.Clerk.user` check — it won't respond to state changes after load.

To update the Clerk publishable key: change `data-clerk-publishable-key` in `index.html`, `results.html`, and `notes.html`.

---

## Backend: app/main.py

- `POST /api/scan` — multipart/form-data: `files` (images/PDFs) + optional `instructions` string
- `MODEL` constant (top of `app/main.py`) selects the Claude model — currently `claude-sonnet-4-6`; `max_tokens=4096`
- `SCAN_PROMPT` constant controls the Claude prompt; edit it there to change transcription/summary behaviour. Currently instructs Claude to use `##`/`- `/`**bold**` markdown in both fields.
- Claude's reply is parsed by extracting the first `{...}` block via regex, then `json.loads` — the prompt forcing JSON-only output is load-bearing. If you change `SCAN_PROMPT` in a way that allows Claude to emit prose before or after the JSON, parsing will break silently (returns 502)
- When `instructions` is non-empty, Claude also returns `additional_notes` in the JSON response
- `scanned_at` (ISO-8601 UTC) is added server-side after parsing Claude's reply — Claude never generates the timestamp (no clock); the frontend formats it friendly per locale
- Response shape: `{"title": "...", "summary": "...", "transcription": "...", "scanned_at": "...", "additional_notes": "..."}` (`additional_notes` omitted when no instructions)
- Static files mounted at `/` via `StaticFiles(directory=".", html=True)` — must come after API routes

**Saved notes API** (`app/db.py` + routes in `app/main.py`):
- `POST /api/notes` — save a scanned note with optional file attachments
- `GET /api/notes` — list saved notes for the signed-in user (supports `?q=` search)
- `GET /api/notes/{id}` — fetch a single note
- `PUT /api/notes/{id}` — update title/summary/transcription
- `DELETE /api/notes/{id}` — delete note + remove files from volume
- `GET /api/notes/{id}/files/{position}` — serve an attached image/PDF (auth'd)

---

## Markdown Rendering

`app.js` contains three functions (defined just before the router at the bottom):

- `escapeHtml(s)` — XSS-safe HTML entity escaping
- `renderMarkdown(text)` — converts `## h2`, `### h3`, `- `/ `* ` lists, `1. ` ordered lists, `**bold**` to HTML; all other content becomes `<p>` wrapped. No external library.
- `setMd(el, text)` — sets `el.innerHTML = renderMarkdown(text)` and stores `el.dataset.rawMd = text`

Summary, transcription, and additional-notes divs are populated via `setMd()`. Edit mode reads `el.dataset.rawMd` (raw markdown) into the textarea; Done re-renders with `setMd()`. `getText(section)` returns `el.dataset.rawMd ?? el.textContent` so share/save always get the raw markdown.

---

## PDF Export

The Export PDF button in `results.html` calls `window.print()`. A `@media print` block at the bottom of `style.css` hides `.back-btn`, `.btn-edit`, `#images-section`, `#share-card`, `.note-actions`, `.copied-msg` and applies clean print typography.

---

## Making Changes

- **Claude prompt**: edit `SCAN_PROMPT` in `app/main.py`
- **Claude model**: edit the `MODEL` constant in `app/main.py`
- **Styling**: CSS variables at top of `style.css`
- **Markdown rendering**: edit `renderMarkdown()` in `app.js`
- **Print styles**: edit `@media print` block at the bottom of `style.css`
- **Share**: single Share panel (`#share-card` in `results.html`) with per-section checkboxes (title/date/image/summary/transcription); the `#share-btn` handler in `app.js` assembles checked sections and calls `share()`
- **Tests**: add blocks inside `runTests()` in `test.html`

---

## Multi-Utility Platform

Auth is live. For future utilities: each gets its own repo + Railway service, sharing the same Clerk app (same `CLERK_PUBLISHABLE_KEY` / `CLERK_JWKS_URL`). Copy `app/auth/verify.py` into each service — no central auth service needed. The `AUTH_HANDOFF.md` in this repo has the full pattern including a reusable `verify.py` template and common gotchas.
