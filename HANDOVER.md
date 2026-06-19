# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-19.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-buster is at **`v=34`** across `index.html`, `results.html`, `notes.html`, `share.html`, `settings.html`, `published.html`.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Additional Notes checkbox in Share panel** — separate "Additional Notes" checkbox alongside Summary/Transcription; checked by default; omitted from output when empty | v34 | `results.html` (`#share-card`), `app.js` (`share-btn` handler) |
| 2 | **Fix: Additional Notes card always visible on results page** — card and Edit button shown from first scan regardless of whether AI generated any notes; users can add notes manually without providing scan instructions | v33 | `app.js` (`initResults`, moved `addCard.hidden = false` outside conditional) |
| 3 | **Fix: single-image share page full width** — single-image notes now use `sp-image-hero` class (same full-width natural-ratio layout as multi-image hero) instead of fixed 220px height | v32 | `app.js` (`initShare` single-image branch) |
| 4 | **Fix: hero image natural aspect ratio** — hero on share/published pages uses natural image dimensions; removed forced 4:3 crop (`aspect-ratio` + `object-fit: cover`) | v31 | `style.css` (`.sp-image-hero`) |
| 5 | **Fix: share page hero + thumbnails for multi-image notes** — first image renders full-width hero, remaining images as 80px thumbnail strip; single-image notes use hero layout too (fixed in v32) | v30 | `app.js` (`initShare` image rendering), `style.css` (`.sp-image-hero`, `.sp-image-thumbs`, `.sp-image-thumb`) |
| 6 | **EasyMDE WYSIWYG editor on edit sections** — clicking Edit on Summary/Transcription/Additional Notes opens EasyMDE (toolbar, preview toggle) instead of a plain textarea; note-title keeps plain input; `getText()` queries active instances so publish/save actions always pick up live content | v29 | `results.html` (CDN scripts), `app.js` (editors Map, toggle handler, getText), `style.css` (EasyMDE theme overrides) |
| 7 | **Fix: published list excluded-image filtering + markdown rendering** — `list_published_notes` filters `excludedImages` from `image_positions`; card snippet uses `renderMarkdown`; `.pub-card-snippet` uses `max-height` clipping | v28 | `app/db.py` (`list_published_notes`), `app.js` (`renderNotes`), `style.css` (`.pub-card-snippet`) |
| 8 | **Fix: text edits persist on publish actions** — `savePublishOptions()` spreads `currentTextFields()` into the PUT body so title/summary edits are never lost when clicking Republish or Save options | v27 | `app.js` (`savePublishOptions`) |
| 9 | **Published list hero layout** — first image shown as full-card-width hero; extra images as thumbnails below the text; responsive CSS grid | v26 | `app.js` (`initPublished` `renderNotes`), `app/db.py` (`list_published_notes` returns `image_positions`), `published.html`, `style.css` |
| 10 | **Delete individual image** — `×` button on each thumbnail in saved mode; `DELETE /api/notes/{id}/files/{position}`; removes tile immediately | v26 | `app/main.py` (`delete_note_file`), `app.js` (`addImageTile`), `style.css` (`.thumb-delete-btn`) |
| 11 | **Add images to saved note** — "+ Add images" button; uploads to `POST /api/notes/{id}/files`; EXIF extracted server-side; button also appears after first save in fresh mode | v26 | `app/main.py` (`add_note_files`), `app/db.py` (`update_note_files`), `app.js` (`enableAddImages`) |
| 12 | **Per-image publish exclusion** — "Exclude" toggle on each thumbnail; excluded images filtered from share page; stored in `publish_options.excludedImages` | v25 | `app.js` (`addImageTile`, `getPublishOptions`, `restorePublishOptions`, `initShare`), `style.css` |
| 13 | **Auto-link URLs in text** — bare http/https URLs in summary/transcription/notes rendered as clickable links | v25 | `app.js` (`inlineFormat` in `renderMarkdown`) |
| 14 | **Settings page** (`/settings`) — global template, logo, story list title, published list visibility | v21 | `settings.html`, `app.js` (`initSettings`), `app/db.py` (`user_settings` table), `app/main.py` |
| 15 | **Published list page** (`/published/{list_token}`) — public list of published notes, search, template-aware | v21 | `published.html`, `app.js` (`initPublished`), `app/main.py` |
| 16 | **Additional Notes card** — separated from Summary into its own editable card (always visible since v33) | v21 | `results.html`, `app.js` |
| 17 | **Publish panel UX** — options locked when published; "Edit options" → "Save options"/"Republish" flow | v21 | `results.html`, `app.js` (`lockPublishOptions`, `unlockPublishOptions`) |
| 18 | **Share page: settings-driven** — template/logo from global settings; logo links to published list; "Home" footer link | v21 | `share.html`, `app.js` (`initShare`), `app/main.py` |
| 19 | **"Include in published list" toggle** — per-note checkbox in publish panel | v21 | `results.html`, `app/db.py` (`list_published_notes` filters `includeInList`) |
| 20 | **My Notes thumbnails + published badge** | v20 | `app.js` (`loadNoteThumbnail`), `app/db.py` (`list_notes` returns `first_image_position`), `style.css` |
| 21 | **Publish panel redesign** — card with section toggles, image position, template swatches | v20 | `results.html`, `app.js`, `app/db.py` (`publish_options` column) |
| 22 | **Lightbox carousel** — prev/next/keyboard navigation | v20 | `results.html`, `app.js`, `style.css` |
| 23 | **share.html redesign** — 3 CSS templates (minimal/bold/magazine) | v20 | `share.html`, `style.css` |

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
7. Scan any note (no instructions needed) → Additional Notes card is visible with an Edit button; click Edit, type, Done, Save → content persists on reload.
8. Open a saved note → Publish card visible → options locked if already published → "Edit options" re-enables → "Save options" / "Republish" work.
9. Open `/settings` → enter title, pick template, enable logo, check "Make list public" → Save → published list URL appears.
10. Publish a note → open share URL in incognito → correct template applied, logo visible (if on), "Home" link in footer navigates to published list.
11. Open published list URL in incognito → cards shown with hero image (for notes with images), search filters, clicking card opens share page.
12. Uncheck "Include in published list" in publish panel → Save options → note disappears from list.
13. My Notes → cards show thumbnails and "↗ Published page" badge for published notes.
