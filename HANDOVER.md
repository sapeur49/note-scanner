# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-18.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches to monitor.

Cache-buster is at **`v=18`** across `index.html`, `results.html`, and `notes.html`.

---

## Features shipped (this session, newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Markdown rendering** in summary + transcription | v18 | `app.js` (`renderMarkdown`, `setMd`), `app/main.py` (`SCAN_PROMPT`), `style.css` (`.result-text` child styles) |
| 2 | **PDF export** via `window.print()` | v18 | `results.html` (Export PDF button + printer icon), `style.css` (`@media print`) |
| 3 | **Back buttons** use `history.back()` with `index.html` fallback | v18 | `results.html`, `notes.html` |
| 4 | **Notes search bar** taller (14px padding, ~1.5×) | v18 | `style.css` (`.notes-search`) |
| 5 | **SVG icon modernization** — all emoji replaced with inline SVG sprite | v17 | `index.html`, `results.html`, `notes.html`, `style.css` (`.icon`) |
| 6 | **Saved notes** — DB persistence, Railway volume, My Notes page | v16 | `app/db.py`, `app/main.py` (CRUD routes), `notes.html`, `app.js` |
| 7 | **Auth fix** — sign-in after sign-out via `Clerk.addListener` | v15 | `app.js` (`initIndex`) |

---

## Known open items (Railway config — not code)

These require action in the Railway dashboard, not in code:

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`. Reference the MySQL service's `${{MySQL.MYSQL_URL}}` variable. **Not** `MYSQL_DATABASE` (just the DB name).
   - If wrong: app boots but logs `[db] … Falling back to SQLite — saved notes will NOT persist across redeploys`.

2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data` set. Saved file attachments land at `<VOLUME_PATH>/notes/<note_id>/`.

---

## End-to-end verification checklist

Run this after any deploy to confirm everything is healthy:

1. Deploy logs show **no** `[db] … Falling back to SQLite` warning → MySQL is wired correctly.
2. Sign in → scan an image and a PDF → click **Save Note** → expect "Saved ✓" (no 401 errors).
3. Click **My Notes** → the saved note appears with title/date/snippet; search by a word from the transcription returns it.
4. Open the note (`results.html?id=…`) → images render, text matches. Edit summary → **Update** → reload → change persisted.
5. **Delete** → note gone from list, volume folder removed.
6. On the results page: summary and transcription render with formatted headings/bullets (not raw `##`/`- ` text).
7. Click **Export PDF** → browser print dialog opens; preview shows clean title + summary + transcription, no nav or buttons.
8. Click **Back** on results or notes page → navigates to the previous page, not always to home.
