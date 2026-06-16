# ReadWrite — Developer Guide

## What This Is

**ReadWrite** is a web app that scans photos of handwritten or printed notes using Claude's vision API. The frontend (HTML/CSS/JS) and backend (FastAPI) are served together from a single Railway service. The GitHub repo is private.

**Live app**: served from Railway (personal account) — check Railway dashboard for current URL.

---

## Architecture

```
Railway (personal account) — single service from this repo
  index.html    — upload UI
  results.html  — results + image strip + share
  app.js        — all frontend logic
  style.css     — shared styles, auto light/dark mode
  test.html     — QA harness
  app/main.py   — FastAPI: serves static files + POST /api/scan
```

**Key decisions:**
- No API key in the browser — key lives server-side only on Railway
- All images sent in one Claude API call as multipart/form-data
- Client-side thumbnails stored in `sessionStorage` as `rw_images`, shown on results page with lightbox
- Results stored in `sessionStorage` as `rw_results`, rendered on `results.html`
- Share via `navigator.share()` → clipboard fallback
- `SCAN_URL` in `app.js` is `/api/scan` (relative — same origin, no hardcoded domain)

---

## File Responsibilities

| File | Purpose |
|---|---|
| `index.html` | Upload UI — drag-drop, file picker, camera, scan button |
| `results.html` | Summary, transcription, image strip (collapsible), edit + share |
| `app.js` | All JS — thumbnail generation, image handling, POST, sessionStorage, lightbox, edit, share |
| `style.css` | Shared styles, CSS variables for auto light/dark mode |
| `test.html` | Self-contained QA harness — runs in browser, no API key needed |
| `app/main.py` | FastAPI — `/api/scan` endpoint + static file mount |
| `SCAN_ENDPOINT.py` | Legacy reference copy of the scan endpoint (superseded by `app/main.py`) |
| `requirements.txt` | Python deps: fastapi, uvicorn, anthropic, python-multipart |
| `Procfile` | Railway start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

---

## Backend: app/main.py

The FastAPI service lives in `app/main.py` in this repo and is deployed directly on Railway.

- **Endpoint**: `POST /api/scan` (multipart/form-data, field name `files`)
- **Prompt**: `SCAN_PROMPT` constant in `app/main.py`
- **Static files**: mounted at `/` via `StaticFiles(directory=".", html=True)` — serves the HTML/CSS/JS frontend

When updating the Claude prompt, edit `SCAN_PROMPT` in `app/main.py`.

**Railway env vars required:**
- `ANTHROPIC_API_KEY` — Claude API key

---

## Claude API Details

- **Model**: `claude-sonnet-4-6`
- **Called from**: Railway (server-side, never browser)
- **Response format**: JSON `{"summary": "...", "transcription": "..."}` — code strips markdown fences before parsing
- **Prompt goal**: flowing prose transcription (no arbitrary line wrapping), concise summary with key points + action items

---

## Data Flow

```
index.html
  → user selects images (file picker / drag-drop / camera)
  → app.js generates compressed thumbnails (canvas, 300px, JPEG 0.6) → sessionStorage rw_images
  → app.js builds FormData with all image files
  → POST to /api/scan
  → Railway calls Claude with all images in one request
  → {summary, transcription} returned → sessionStorage rw_results
  → redirect to results.html

results.html
  → reads rw_results + rw_images from sessionStorage
  → shows collapsible image strip (thumbnails → lightbox on click)
  → renders summary first, transcription below
  → Edit button toggles section to <textarea> for corrections
  → Share buttons call navigator.share() or clipboard fallback
```

---

## Local Development

```bash
pip install -r requirements.txt
ANTHROPIC_API_KEY=sk-... uvicorn app.main:app --reload
# Open http://localhost:8000
```

Cache busting: asset files use `?v=N` query strings in HTML. Bump N when deploying JS/CSS changes.

---

## Deployment

Push to `main` → Railway auto-deploys from this repo (~1-2 min).

The `.github/workflows/` files are unused (left over from the GitHub Pages era) — harmless.

---

## Future: Multi-Utility Platform with Auth

**Architecture decision (Option A — recommended):**

Each utility (ReadWrite and future tools) lives in its **own Railway service and repo**. Auth is verified independently in each service using the same Clerk app. A central hub page links to all tools.

- Each service includes the same ~10-line JWT verification function
- Adding/removing a utility doesn't touch other services
- Independent deploys, independent failure domains
- If Stripe billing is added later, the subscription check is a second FastAPI dependency alongside auth — same pattern, per-service

This contrasts with Option B (monorepo, single service, all tools as routes) which couples everything together.

**Clerk auth implementation (not started):**
- Frontend: Clerk JS SDK via CDN — wraps upload UI behind sign-in
- Frontend: fetch session JWT, send as `Authorization: Bearer <token>` on `/api/scan`
- Backend: verify JWT using Clerk's JWKS endpoint (PyJWT + httpx, ~10 lines)
- Railway env vars: `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`
- Effort: ~half a day

**Billing (future, after auth):**
- Stripe subscriptions with `require_active_subscription()` FastAPI dependency
- `402` response on expired subscription

---

## Making Changes

- **Claude prompt**: edit `SCAN_PROMPT` in `app/main.py`
- **Styling**: edit CSS variables at top of `style.css`
- **Share formats**: add button in `results.html` with `data-target`, handle in `share()` in `app.js`
- **Tests**: add blocks inside `runTests()` in `test.html`
- **New utility**: new repo + new Railway service, copy the Clerk JWT verification pattern
