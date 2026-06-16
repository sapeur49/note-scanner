# ReadWrite — Developer Guide

## What This Is

**ReadWrite** is a static web app (GitHub Pages) that scans photos of handwritten or printed notes using Claude's vision API. No build step, no npm — pure HTML/CSS/JS frontend calling a FastAPI backend on Railway.

**Live app**: `https://sapeur49.github.io/note-scanner/`

---

## Architecture

```
GitHub Pages (static frontend)          Railway (FastAPI backend)
  index.html   — upload UI        →→→   ra-match-scanner service
  results.html — results + share        POST /api/scan
  app.js       — all logic              reads ANTHROPIC_API_KEY env var
  style.css    — shared styles          calls Claude claude-sonnet-4-6
  test.html    — QA harness             returns {summary, transcription}
```

**Key decisions already made:**
- No API key in the browser — key lives server-side only on Railway
- All images sent in one Claude API call as base64 multipart/form-data
- Results stored in `sessionStorage`, rendered on `results.html`
- Share via `navigator.share()` → clipboard fallback
- API key stored as `ANTHROPIC_API_KEY` env var on the `ra-match-scanner` Railway service
- `ALLOWED_ORIGINS` env var on Railway controls CORS

---

## File Responsibilities

| File | Purpose |
|---|---|
| `index.html` | Upload UI — drag-drop, file picker, camera, scan button |
| `results.html` | Summary first, full transcription below, edit + share buttons |
| `app.js` | All JS — image handling, POST to Railway, sessionStorage, edit toggle, share |
| `style.css` | Shared styles, CSS variables for auto light/dark mode |
| `test.html` | Self-contained QA harness — runs in browser, no API key needed |
| `SCAN_ENDPOINT.py` | Reference copy of the `/api/scan` endpoint (lives in `ra-match-scanner/app/main.py`) |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages on push to main |

---

## Backend: ra-match-scanner

The `/api/scan` endpoint lives in a **separate repo** (`ra-match-scanner`) on Railway.

- **Railway service URL**: `https://ra-match-scanner.up.railway.app`
- **Endpoint**: `POST /api/scan` (multipart/form-data, field name `files`)
- **Prompt**: `SCAN_PROMPT` constant in `ra-match-scanner/app/main.py`
- **Pattern**: mirrors `ra-match-scanner`'s `/api/extract` — same `anthropic.Anthropic` client, same `db()` context manager pattern

When updating the Claude prompt, edit `SCAN_PROMPT` in **`ra-match-scanner/app/main.py`** and redeploy that service. The reference copy in `SCAN_ENDPOINT.py` here should be kept in sync.

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
  → app.js builds FormData with all image files
  → POST to https://ra-match-scanner.up.railway.app/api/scan
  → Railway calls Claude with all images in one request
  → {summary, transcription} returned
  → stored in sessionStorage as rw_results
  → redirect to results.html

results.html
  → reads rw_results from sessionStorage
  → renders summary first, transcription below
  → Edit button toggles section to <textarea> for corrections
  → Share buttons call navigator.share() or clipboard fallback
```

---

## Local Development

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

Note: Web Share API requires HTTPS. On localhost, share falls back to clipboard. Test native sharing on the live GitHub Pages URL.

Cache busting: asset files use `?v=N` query strings in HTML. Bump N when deploying JS/CSS changes that aren't being picked up.

---

## QA / Review Workflow

1. Open `https://sapeur49.github.io/note-scanner/test.html`
2. Tests run automatically — all items should show **PASS**
3. Claude Code can fetch this URL and scan for `FAIL` to automate the check

---

## Deployment

Push to `main` → GitHub Actions deploys to GitHub Pages automatically (~1-2 min).

Two workflow files exist (`.github/workflows/pages.yml` and `static.yml` added by GitHub UI) — both do the same thing, harmless duplication.

GitHub Pages requires the repo to be **public**. Settings → Pages → Source: GitHub Actions.

---

## Future: Freemium Platform

Exploratory plan exists — a shared platform API (auth + billing) serving ReadWrite and future utilities:
- **Auth**: Clerk (managed) — JWT verification server-side
- **Billing**: Stripe subscriptions, 14-day free trial, `402` on expiry
- **Gate**: single `require_active_user()` FastAPI dependency used by every utility endpoint
- **New Railway service**: the hobby `note-scanner` Railway service would become the platform API
- **Not started yet** — ReadWrite currently has no paywall

When ready to build, see the plan at `.claude/plans/help-me-create-a-cosmic-hartmanis.md`.

---

## Making Changes

- **Claude prompt**: update `SCAN_PROMPT` in `ra-match-scanner/app/main.py` + redeploy that service. Keep `SCAN_ENDPOINT.py` in sync.
- **Styling**: edit CSS variables at top of `style.css`
- **Share formats**: add button in `results.html` with `data-target`, handle in `share()` in `app.js`
- **Tests**: add blocks inside `runTests()` in `test.html`
- **New utility**: new static frontend + new gated endpoint on the platform (future)
