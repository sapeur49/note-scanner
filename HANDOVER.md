# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-19.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-buster is at **`v=32`** across `index.html`, `results.html`, `notes.html`, `share.html`, `settings.html`, `published.html`.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Fix: single-image share page full width** — single-image notes now use the same full-width natural-ratio hero layout as multi-image notes | v32 | `app.js` (`initShare` single-image branch) |
| 2 | **Fix: hero image natural aspect ratio + Additional Notes always visible** — hero on share page uses natural image dimensions (no forced 4:3 crop); Additional Notes card always shown in results so users can add notes without scan instructions | v31 | `style.css` (`.sp-image-hero`), `app.js` (`initResults` additional-notes unhide) |
| 2 | **Fix: share page hero + thumbnails for multi-image notes** — first image renders full-width 4:3 hero, remaining images as 80px thumbnail strip; single-image notes unchanged | v30 | `app.js` (`initShare` image rendering), `style.css` (`.sp-image-hero`, `.sp-image-thumbs`, `.sp-image-thumb`) |
| 2 | **EasyMDE WYSIWYG editor on edit sections** — clicking Edit on Summary/Transcription/Additional Notes now opens EasyMDE (toolbar, preview toggle) instead of a plain textarea; note-title keeps plain input; getText() queries active instances so publish/save actions always pick up live content | v29 | `results.html` (CDN scripts), `app.js` (editors Map, toggle handler, getText), `style.css` (EasyMDE theme overrides) |
| 2 | **Fix: published list excluded-image filtering + markdown rendering** — `list_published_notes` now filters `excludedImages` from `image_positions`; card snippet uses `renderMarkdown` instead of `escapeHtml`; `.pub-card-snippet` CSS updated to `max-height` clipping to support block elements | v28 | `app/db.py` (`list_published_notes`), `app.js` (`renderNotes`), `style.css` (`.pub-card-snippet`) |
| 2 | **Fix: text edits persist on publish actions** — `savePublishOptions()` now spreads `currentTextFields()` into the PUT body so title/summary/transcription changes are never lost when clicking Republish or Save options | v27 | `app.js` (`savePublishOptions`) |
| 2 | **Published list hero layout** — first image shown as full-card-width 4:3 hero; extra images as small thumbnails below the text; cards displayed in responsive CSS grid | v26 | `app.js` (`initPublished` `renderNotes`), `app/db.py` (`list_published_notes` returns `image_positions`), `published.html`, `style.css` (`.pub-card-grid`, `.pub-card-hero`, etc.) |
| 3 | **Delete individual image** — `×` button on each thumbnail in saved mode; calls `DELETE /api/notes/{id}/files/{position}`; removes tile immediately | v26 | `app/main.py` (`delete_note_file`), `app.js` (`addImageTile`), `style.css` (`.thumb-delete-btn`) |
| 4 | **Add images to saved note** — "+ Add images" button on saved notes; uploads to `POST /api/notes/{id}/files`; EXIF extracted server-side; tiles rendered immediately; button also appears after first save in fresh mode | v26 | `app/main.py` (`add_note_files`), `app/db.py` (`update_note_files`), `results.html`, `app.js` (`enableAddImages`), `style.css` |
| 5 | **Per-image publish exclusion** — "Exclude" toggle on each image thumbnail; excluded images filtered from share page; positions stored in `publish_options.excludedImages` | v25 | `app.js` (`addImageTile`, `getPublishOptions`, `restorePublishOptions`, `initShare`), `style.css` (`.pub-exclude-btn`) |
| 6 | **Auto-link URLs in text** — bare http/https URLs in summary/transcription/notes rendered as clickable links | v25 | `app.js` (`inlineFormat` in `renderMarkdown`) |
| 7 | **Settings page** (`/settings`) — global template, logo, story list title, published list visibility | v21 | `settings.html`, `app.js` (`initSettings`), `app/db.py` (`user_settings` table), `app/main.py` (`GET/PUT /api/settings`) |
| 8 | **Published list page** (`/published/{list_token}`) — public list of published notes, search, template-aware | v21 | `published.html`, `app.js` (`initPublished`), `app/main.py` (`GET /api/published/{list_token}`) |
| 9 | **Additional Notes** — separated from Summary into its own editable card | v21 | `results.html`, `app.js` |
| 10 | **Publish panel UX** — options locked when published; "Edit options" → "Save options"/"Republish" flow | v21 | `results.html`, `app.js` (`lockPublishOptions`, `unlockPublishOptions`) |
| 11 | **Share page: settings-driven** — template/logo from global settings; logo links to published list; "Home" footer link | v21 | `share.html`, `app.js` (`initShare`), `app/main.py` (share endpoint now includes owner settings) |
| 12 | **"Include in published list" toggle** — per-note checkbox in publish panel | v21 | `results.html`, `app/db.py` (`list_published_notes` filters `includeInList`) |
| 13 | **My Notes thumbnails + published badge** | v20 | `app.js` (`loadNoteThumbnail`), `app/db.py` (`list_notes` returns `first_image_position`), `style.css` |
| 14 | **Publish panel redesign** — card with section toggles, image position, template swatches | v20 | `results.html`, `app.js`, `app/db.py` (`publish_options` column) |
| 15 | **Lightbox carousel** — prev/next/keyboard navigation | v20 | `results.html`, `app.js`, `style.css` |
| 16 | **share.html redesign** — 3 CSS templates (minimal/bold/magazine) | v20 | `share.html`, `style.css` |

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
- `excludedImages` — array of image positions hidden from the share page

**Important**: `savePublishOptions()` sends text fields (`title`, `summary`, etc.) alongside `publish_options` in the same PUT, so any text edits are committed at the same time as option saves — no separate "Save edits" required before using publish actions.

---

## Image management

- Images stored at `VOLUME_PATH/notes/{note_id}/{position}.jpg` (or `.pdf`)
- `POST /api/notes/{id}/files` — add images to an existing saved note; positions continue from the highest existing position
- `DELETE /api/notes/{id}/files/{position}` — remove a single image; updates `files` JSON column and deletes from disk
- `GET /api/share/{token}/images/{position}` — public (no auth) endpoint for serving images on share/published pages
- `GET /api/notes/{id}/files/{position}` — auth'd endpoint for serving images in My Notes thumbnails / results view
- Hero image on published list: `list_published_notes()` returns `image_positions` (all image positions, non-excluded filtering not yet applied at list level); first position used as hero in `renderNotes()`

---

## Known open items (Railway config — not code)

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`. Reference the MySQL service's `${{MySQL.MYSQL_URL}}` variable.
2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data` set. If not configured, images are written to an ephemeral path and lost on redeploy — hero images on the published list will 404.

---

## End-to-end verification checklist

1. Deploy logs show no `[db] … Falling back to SQLite` warning.
2. Sign in → scan a phone photo → EXIF "Image info" toggle appears under thumbnail.
3. Save note → "+" Add images" button appears immediately below image strip (even on a fresh-scan result page after saving).
4. Open a saved note → click `×` on a thumbnail → image removed from strip and from disk.
5. Click "Exclude" on a thumbnail → toggle turns red/active → publish → share page hides that image.
6. Edit title → click "Republish" (without clicking "Save edits") → share page shows updated title.
7. Save note → Additional Notes card appears (if instructions were given) with its own Edit button.
8. Open a saved note → Publish card visible → options locked if already published → "Edit options" re-enables → "Save options" / "Republish" work.
9. Open `/settings` → enter title, pick template, enable logo, check "Make list public" → Save → published list URL appears.
10. Publish a note → open share URL in incognito → correct template applied, logo visible (if on), "Home" link in footer navigates to published list.
11. Open published list URL in incognito → cards shown with hero image (for notes with images), search filters, clicking card opens share page.
12. Uncheck "Include in published list" in publish panel → Save options → note disappears from list.
13. My Notes → cards show thumbnails and "↗ Published page" badge for published notes.
