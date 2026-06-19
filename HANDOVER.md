# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-19.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-buster is at **`v=19`** across `index.html`, `results.html`, `notes.html`, and `share.html` (absolute paths in share.html).

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **EXIF extraction** — camera, date, GPS from images; shown as floating panel under each thumbnail | v19 | `app/main.py` (`_extract_exif`, `_parse_gps`, prompt append), `app.js` (`addImageTile`), `style.css` (`.exif-dl` absolute-positioned panel) |
| 2 | **Server-hosted share pages** — publish/unpublish toggle; share URL at `/share/{token}` | v19 | `app/main.py` (publish routes, `/share/{token}`), `app/db.py` (`share_token` column, `publish_note`, `unpublish_note`, `get_note_by_share_token`), `share.html`, `results.html` (`#publish-btn`, `#unpublish-btn`, `#share-link-row`), `app.js` (`initShare`, publish handlers) |
| 3 | **PDF export removed** — `window.print()` doesn't work on iOS; replaced by server-hosted share | v19 | `results.html` (removed `#export-btn`), `style.css` (removed `@media print`) |
| 4 | **Markdown rendering** in summary + transcription | v18 | `app.js` (`renderMarkdown`, `setMd`), `app/main.py` (`SCAN_PROMPT`) |
| 5 | **Back buttons** use `history.back()` with `index.html` fallback | v18 | `results.html`, `notes.html` |
| 6 | **Saved notes** — DB persistence, Railway volume, My Notes page | v16 | `app/db.py`, `app/main.py` (CRUD routes), `notes.html`, `app.js` |

---

## Known open items (Railway config — not code)

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`. Reference the MySQL service's `${{MySQL.MYSQL_URL}}` variable.
2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data` set.

---

## End-to-end verification checklist

1. Deploy logs show no `[db] … Falling back to SQLite` warning.
2. Sign in → scan a phone photo → confirm EXIF "Image info" toggle appears under the thumbnail with camera name, date, ISO, aperture, shutter. GPS shows as a clickable link if present.
3. Scan a screenshot or PDF → confirm no "Image info" toggle.
4. Save the note → "Publish Page" button appears.
5. Click Publish → share link appears → open in incognito → note renders (title, summary, transcription visible without login).
6. Click Unpublish → link returns 404 in incognito.
7. My Notes → saved note appears; search by a word from the transcription finds it.
8. Open a note → edit summary → Update → reload → change persisted.
9. Delete → note gone from list, volume folder removed.
