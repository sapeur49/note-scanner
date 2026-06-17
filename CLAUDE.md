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

Push to `main` → Railway auto-deploys (~1-2 min). The `.github/workflows/` files are unused leftovers — harmless.

**Railway env vars required:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint, e.g. `https://<clerk-domain>/.well-known/jwks.json` |
| `CLERK_ISSUER` | Optional — Clerk issuer URL for stricter JWT validation |

---

## Architecture

```
app/main.py        FastAPI: POST /api/scan + static file mount
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
index.html         Upload UI (sign-in wall + app div, shown/hidden by Clerk JS)
results.html       Results: image strip, summary, additional notes, transcription, share
app.js             All frontend logic — auth, thumbnails, scan POST, sessionStorage, lightbox, edit, share
style.css          Shared styles, CSS variables, auto light/dark mode
test.html          Browser-based QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` stays server-side only; never sent to browser
- All files sent in one Claude API call (multipart/form-data); images as `image` blocks, PDFs as `document` blocks
- Client-side image resizing before POST: 150px/JPEG-0.5 thumbnails → `rw_images`, 1500px/JPEG-0.85 lightbox images → `rw_lightbox`, both in `sessionStorage`; PDFs get a placeholder tile (no client-side render)
- Results stored as `rw_results` in `sessionStorage`; `results.html` reads and renders them
- `SCAN_URL = '/api/scan'` is relative — same origin, no hardcoded domain

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
- `SCAN_PROMPT` constant controls the Claude prompt; edit it there to change transcription/summary behaviour
- When `instructions` is non-empty, Claude also returns `additional_notes` in the JSON response
- Response shape: `{"summary": "...", "transcription": "...", "additional_notes": "..."}` (`additional_notes` omitted when no instructions)
- Static files mounted at `/` via `StaticFiles(directory=".", html=True)` — must come after API routes

---

## Making Changes

- **Claude prompt**: edit `SCAN_PROMPT` in `app/main.py`
- **Styling**: CSS variables at top of `style.css`
- **Share formats**: add `data-target` button in `results.html`, handle in `share()` in `app.js`
- **Tests**: add blocks inside `runTests()` in `test.html`

---

## Future Auth / Multi-Utility Platform

See `AUTH_HANDOFF.md` for the full architecture plan. Summary: each future utility gets its own repo + Railway service, all sharing the same Clerk app. Copy `app/auth/verify.py` into each service.
