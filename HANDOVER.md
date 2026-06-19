# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-19.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-buster is at **`v=24`** across `index.html`, `results.html`, `notes.html`, `share.html`, `settings.html`, `published.html`.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Add images to saved note** — "+ Add images" button on saved note; uploads to `POST /api/notes/{id}/files`; EXIF extracted server-side; tiles rendered immediately | v23 | `app/main.py` (`add_note_files`), `app/db.py` (`update_note_files`), `results.html`, `app.js`, `style.css` |
| 2 | **Per-image publish exclusion** — "Exclude" toggle on each image thumbnail; excluded images filtered from share page | v22 | `app.js` (`addImageTile`, `getPublishOptions`, `restorePublishOptions`, `initShare`), `style.css` (`.pub-exclude-btn`) |
| 2 | **Auto-link URLs in text** — bare http/https URLs in summary/transcription/notes rendered as clickable links | v22 | `app.js` (`inlineFormat` in `renderMarkdown`) |
| 3 | **Settings page** (`/settings`) — global template, logo, story list title, published list visibility | v21 | `settings.html`, `app.js` (`initSettings`), `app/db.py` (`user_settings` table), `app/main.py` (`GET/PUT /api/settings`) |
| 2 | **Published list page** (`/published/{list_token}`) — public list of published notes, search, template-aware | v21 | `published.html`, `app.js` (`initPublished`), `app/main.py` (`GET /api/published/{list_token}`) |
| 3 | **Additional Notes** — separated from Summary into its own editable card | v21 | `results.html`, `app.js` |
| 4 | **Publish panel UX** — options locked when published; "Edit options" → "Save options"/"Republish" flow | v21 | `results.html`, `app.js` (`lockPublishOptions`, `unlockPublishOptions`) |
| 5 | **Share page: settings-driven** — template/logo from global settings; logo links to published list; "Home" footer link | v21 | `share.html`, `app.js` (`initShare`), `app/main.py` (share endpoint now includes owner settings) |
| 6 | **"Include in published list" toggle** — per-note checkbox in publish panel | v21 | `results.html`, `app/db.py` (`list_published_notes` filters `includeInList`) |
| 7 | **Publish link plain text** — removed box/border styling from share link display | v21 | `style.css` |
| 8 | **Images "top" position fix** — now appears below page title on share pages | v21 | `share.html` |
| 9 | **My Notes thumbnails + published badge** | v20 | `app.js` (`loadNoteThumbnail`), `app/db.py` (`list_notes` returns `first_image_position`), `style.css` |
| 10 | **Publish panel redesign** — card with section toggles, image position, template swatches | v20 | `results.html`, `app.js`, `app/db.py` (`publish_options` column) |
| 11 | **Lightbox carousel** — prev/next/keyboard navigation | v20 | `results.html`, `app.js`, `style.css` |
| 12 | **share.html redesign** — 3 CSS templates (minimal/bold/magazine), B&W contemporary layout | v20 | `share.html`, `style.css` |
| 13 | **Public image endpoint** `GET /api/share/{token}/images/{position}` | v20 | `app/main.py` |
| 14 | **Date/time UTC fix** — `_iso()` appends `+00:00` so JS parses correctly | v20 | `app/db.py` |
| 15 | **markdownToPlainText()** — strips markdown for share/copy text | v20 | `app.js` |
| 16 | **EXIF extraction** — camera, date, GPS; shown as floating panel under thumbnails | v19 | `app/main.py`, `app.js`, `style.css` |
| 17 | **Server-hosted share pages** — publish/unpublish, `/share/{token}` | v19 | `app/main.py`, `app/db.py`, `share.html`, `results.html`, `app.js` |
| 18 | **Markdown rendering** in summary + transcription | v18 | `app.js`, `app/main.py` |
| 19 | **Saved notes** — DB persistence, Railway volume, My Notes page | v16 | `app/db.py`, `app/main.py`, `notes.html`, `app.js` |

---

## Publish options architecture

**Global settings** (per user, in `user_settings` table):
- `template` — minimal / bold / magazine — applied to all share pages and the published list
- `logo_on` — show ReadWrite logo on published pages
- `story_list_title` — heading on the published list page
- `list_public` — whether `/published/{list_token}` is publicly accessible
- `list_token` — stable UUID for the published list URL (auto-generated on first save)

**Per-note options** (`publish_options` JSON column on `notes`):
- `showImages`, `showSectionTitles`, `showSummary`, `showTranscription`, `showAdditional`
- `imagePosition` — top / after-summary / after-transcription / bottom
- `includeInList` — whether this note appears on the published list page

---

## Known open items (Railway config — not code)

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`. Reference the MySQL service's `${{MySQL.MYSQL_URL}}` variable.
2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data` set.

---

## End-to-end verification checklist

1. Deploy logs show no `[db] … Falling back to SQLite` warning.
2. Sign in → scan a phone photo → EXIF "Image info" toggle appears under thumbnail.
3. Save note → Additional Notes card appears (if instructions were given) with its own Edit button.
4. Open a saved note → Publish card visible → options locked if already published → "Edit options" re-enables → "Save options" / "Republish" work.
5. Open `/settings` → enter title, pick template, enable logo, check "Make list public" → Save → published list URL appears.
6. Publish a note → open share URL in incognito → correct template applied, logo visible (if on), "Home" link in footer navigates to published list.
7. Open published list URL in incognito → cards shown, search filters, thumbnails load, clicking card opens share page.
8. Uncheck "Include in published list" in publish panel → Save options → note disappears from list.
9. My Notes → cards show thumbnails and "↗ Published page" badge for published notes.
10. Search in My Notes finds by title/summary/transcription.
