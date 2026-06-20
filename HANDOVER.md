# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-19.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-buster is at **`v=37`** across `index.html`, `results.html`, `notes.html`, `share.html`, `settings.html`, `published.html`.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Exclude button auto-saves** — clicking Exclude on a thumbnail immediately persists `publish_options` (including `excludedImages`) without a manual Save; `savePublishOptions()` called directly in the exclude click handler | v37 | `app.js` (`addImageTile`) |
| 2 | **Owner pencil edit button on share page** — subtle fixed-position pencil icon (top-right) links to `results.html?id={note_id}`; visible only to the note owner; for public notes uses async Clerk check + second authenticated fetch; invisible in incognito or other accounts | v36 | `app/main.py` (`share_data_route` lifts `req_user`, adds `is_owner`), `share.html` (`#sp-edit-btn`), `app.js` (`initShare` owner check), `style.css` (`.sp-edit-btn`) |
| 3 | **Done = save** — clicking Done on any editable field (title, summary, transcription, notes, date) in saved mode immediately auto-saves to server via `autoSave()`; "Saved ✓" toast shown for 1.5 s; Save button hidden in saved mode | v35 | `app.js` (`autoSave`, Done handler) |
| 4 | **Fix: date editing** — scan date now editable via `datetime-local` picker; `scanned_at` added to `_EDITABLE`; parsed via `_parse_dt()` before DB write | v35 | `app.js` (Done handler for `note-date`, `currentTextFields`), `app/db.py` (`_EDITABLE`, `_parse_dt`, `update_note`) |
| 5 | **Persistent share token** — Unpublish sets `is_published=False` only (token preserved); share URL stays visible but dimmed with "Currently unpublished" label + Republish button; Republish reuses same URL | v35 | `app/db.py` (`unpublish_note`, `get_note_by_share_token`), `app.js` (`showUnpublishedLink`, `hideShareLink`, unpublish handler), `results.html` (`#share-unpublished-label`), `style.css` (`.share-link-unpublished`, `.share-unpublished-label`) |
| 6 | **Visibility levels** — per-note access control: Public / Logged in / Me only; enforced in `share_data_route`; share page handles 401 (sign-in wall) and 403 (private message); Clerk loaded on `share.html` | v35 | `app/db.py` (`visibility` column + migration), `app/main.py` (`share_data_route` auth), `results.html` (`#pub-visibility` select), `app.js` (`getPublishOptions`, `restorePublishOptions`, `savePublishOptions`, `initShare` 401 flow), `share.html` (Clerk script), `style.css` (`.pub-visibility-select`) |
| 7 | **Prev/Next navigation on share page** — ← and → links flanking "Home" in footer when published list is public + note has adjacent entries | v35 | `app/db.py` (`get_adjacent_published_notes`), `app/main.py` (adds `prev_token`/`next_token` to share response), `app.js` (`initShare` footer nav), `style.css` (`.sp-nav-link`) |
| 8 | **Additional Notes checkbox in Share panel** — separate "Additional Notes" checkbox alongside Summary/Transcription; checked by default; omitted from output when empty | v34 | `results.html` (`#share-card`), `app.js` (`share-btn` handler) |
| 9 | **Fix: Additional Notes card always visible on results page** — card and Edit button shown from first scan regardless of whether AI generated any notes | v33 | `app.js` (`initResults`, moved `addCard.hidden = false` outside conditional) |
| 10 | **Fix: single-image share page full width** — single-image notes use `sp-image-hero` class instead of fixed 220px height | v32 | `app.js` (`initShare` single-image branch) |
| 11 | **Fix: hero image natural aspect ratio** — removed forced 4:3 crop | v31 | `style.css` (`.sp-image-hero`) |
| 12 | **Fix: share page hero + thumbnails for multi-image notes** — first image full-width hero, remaining images as 80px thumbnail strip | v30 | `app.js` (`initShare` image rendering), `style.css` (`.sp-image-hero`, `.sp-image-thumbs`, `.sp-image-thumb`) |
| 13 | **EasyMDE WYSIWYG editor on edit sections** — clicking Edit on Summary/Transcription/Additional Notes opens EasyMDE instead of a plain textarea | v29 | `results.html` (CDN scripts), `app.js` (editors Map, toggle handler, getText), `style.css` (EasyMDE theme overrides) |
| 14 | **Fix: published list excluded-image filtering + markdown rendering** | v28 | `app/db.py` (`list_published_notes`), `app.js` (`renderNotes`), `style.css` (`.pub-card-snippet`) |
| 15 | **Fix: text edits persist on publish actions** — `savePublishOptions()` spreads `currentTextFields()` into PUT body | v27 | `app.js` (`savePublishOptions`) |
| 16 | **Published list hero layout** — first image full-card-width hero; extra images as thumbnails below text | v26 | `app.js` (`initPublished` `renderNotes`), `app/db.py` (`list_published_notes` returns `image_positions`), `published.html`, `style.css` |
| 17 | **Delete individual image** — `×` button on each thumbnail in saved mode | v26 | `app/main.py` (`delete_note_file`), `app.js` (`addImageTile`), `style.css` (`.thumb-delete-btn`) |
| 18 | **Add images to saved note** — "+ Add images" button; uploads to `POST /api/notes/{id}/files` | v26 | `app/main.py` (`add_note_files`), `app/db.py` (`update_note_files`), `app.js` (`enableAddImages`) |
| 19 | **Per-image publish exclusion** — "Exclude" toggle on each thumbnail; filtered from share page | v25 | `app.js` (`addImageTile`, `getPublishOptions`, `restorePublishOptions`, `initShare`), `style.css` |
| 20 | **Auto-link URLs in text** — bare http/https URLs rendered as clickable links | v25 | `app.js` (`inlineFormat` in `renderMarkdown`) |
| 21 | **Settings page** (`/settings`) — global template, logo, story list title, published list visibility | v21 | `settings.html`, `app.js` (`initSettings`), `app/db.py` (`user_settings` table), `app/main.py` |
| 22 | **Published list page** (`/published/{list_token}`) — public list of published notes, search, template-aware | v21 | `published.html`, `app.js` (`initPublished`), `app/main.py` |
| 23 | **Additional Notes card** — separated from Summary into its own editable card | v21 | `results.html`, `app.js` |
| 24 | **Publish panel UX** — options locked when published; "Edit options" → "Save options"/"Republish" flow | v21 | `results.html`, `app.js` (`lockPublishOptions`, `unlockPublishOptions`) |
| 25 | **Share page: settings-driven** — template/logo from global settings; logo links to published list | v21 | `share.html`, `app.js` (`initShare`), `app/main.py` |
| 26 | **"Include in published list" toggle** — per-note checkbox in publish panel | v21 | `results.html`, `app/db.py` (`list_published_notes` filters `includeInList`) |
| 27 | **My Notes thumbnails + published badge** | v20 | `app.js` (`loadNoteThumbnail`), `app/db.py` (`list_notes` returns `first_image_position`), `style.css` |
| 28 | **Publish panel redesign** — card with section toggles, image position, template swatches | v20 | `results.html`, `app.js`, `app/db.py` (`publish_options` column) |
| 29 | **Lightbox carousel** — prev/next/keyboard navigation | v20 | `results.html`, `app.js`, `style.css` |
| 30 | **share.html redesign** — 3 CSS templates (minimal/bold/magazine) | v20 | `share.html`, `style.css` |

---

## Publish options architecture

**Global settings** (per user, in `user_settings` table):
- `template` — minimal / bold / magazine — applied to all share pages and the published list
- `logo_on` — show ReadWrite logo on published pages
- `story_list_title` — heading on the published list page
- `list_public` — whether `/published/{list_token}` is publicly accessible
- `list_token` — stable UUID for the published list URL (auto-generated on first save)

**Per-note columns on `notes`:**
- `visibility` — `public` / `logged_in` / `me` — enforced in `share_data_route`; selected in publish panel via `#pub-visibility`
- `is_published` — Boolean; Unpublish sets this `False` (token preserved); controls whether share URL resolves
- `share_token` — stable UUID; preserved across publish/unpublish cycles

**Per-note publish_options** (JSON column on `notes`):
- `showImages`, `showSectionTitles`, `showSummary`, `showTranscription`, `showAdditional`
- `imagePosition` — top / after-summary / after-transcription / bottom
- `includeInList` — whether this note appears on the published list page
- `excludedImages` — array of image positions hidden from the share page

**Share response extras** (returned by `GET /api/share/{token}`):
- `is_owner: true` — set when authenticated requester is the note owner; drives the pencil edit button
- `prev_token` / `next_token` — adjacent published note tokens; drives ← → footer nav

**Important**: `savePublishOptions()` sends text fields (`title`, `summary`, etc.) alongside `publish_options` and `visibility` in the same PUT, so any text edits are committed at the same time as option saves — no separate "Save edits" required before using publish actions.

---

## Image management

- Images stored at `VOLUME_PATH/notes/{note_id}/{position}.jpg` (or `.pdf`)
- `POST /api/notes/{id}/files` — add images to an existing saved note; positions continue from the highest existing position
- `DELETE /api/notes/{id}/files/{position}` — remove a single image; updates `files` JSON column and deletes from disk
- `GET /api/share/{token}/images/{position}` — public (no auth) endpoint for serving images on share/published pages
- `GET /api/notes/{id}/files/{position}` — auth'd endpoint for serving images in My Notes thumbnails / results view
- Hero image on published list: `list_published_notes()` returns `image_positions`; first position used as hero in `renderNotes()`

---

## Known open items (Railway config — not code)

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`. Reference the MySQL service's `${{MySQL.MYSQL_URL}}` variable.
2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data` set. If not configured, images are written to an ephemeral path and lost on redeploy — hero images on the published list will 404.

---

## End-to-end verification checklist

1. Deploy logs show no `[db] … Falling back to SQLite` warning.
2. Sign in → scan a phone photo → EXIF "Image info" toggle appears under thumbnail.
3. Save note → "+ Add images" button appears immediately below image strip.
4. Open a saved note → click `×` on a thumbnail → image removed from strip and from disk.
5. Click "Exclude" on a thumbnail → toggle turns red/active → share page hides that image; no manual Save needed (auto-saves immediately).
6. Edit title in saved mode → click Done → "Saved ✓" toast appears → reload confirms title persisted (no Save button click needed).
7. Edit scan date in saved mode → Done → date updates in UI and persists on reload.
8. Publish note → copy URL → Unpublish → URL shows dimmed with "Currently unpublished" label. Visiting URL returns 404. Republish → same URL resolves again.
9. Set visibility to "Logged in" → open share URL in incognito → sign-in wall appears → sign in → note renders.
10. Set visibility to "Me only" → share URL in different account → "This note is private" shown.
11. Open published share page as owner → pencil icon (top-right) appears within ~1 s → click → lands on `results.html?id={note_id}`.
12. Open same share URL in incognito or different account → no pencil icon.
13. Share page with adjacent published notes + public list → ← and → appear flanking "Home" in footer; clicking navigates correctly; first/last note shows only one arrow.
14. Scan any note (no instructions) → Additional Notes card visible with Edit button; click Edit, type, Done → auto-saves; content persists on reload.
15. Open published list URL in incognito → cards shown with hero image, search filters; clicking card opens share page.
16. Uncheck "Include in published list" → Save options → note disappears from list.
17. My Notes → cards show thumbnails and "↗ Published page" badge for published notes.
18. Open `/settings` → enter title, pick template, enable logo, check "Make list public" → Save → published list URL appears.
