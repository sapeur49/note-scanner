# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-20.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-busters: **`style.css?v=46`**, **`app.js?v=52`** across all six HTML files.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 1 | **Adaptive scan prompt** — non-text images (photos, objects, scenes) now get analytical description in `summary` + any visible labels in `transcription` instead of refusal | — | `app/main.py` (`SCAN_PROMPT`) |
| 2 | **Publish visibility default → "Me only"** — new notes default to private; user must opt in to share publicly | — | `results.html` (`#pub-visibility` select) |
| 3 | **Globe button on home page** — globe icon (links to published list) added to `#header-right` left of the folder icon; hidden until settings confirm `list_token` exists | v52 | `index.html`, `app.js` (`initIndex`) |
| 4 | **Security fix: restricted notes hidden from public published list** — `logged_in`/`me` notes no longer shown to unauthenticated or non-owner viewers on `/api/published/{list_token}` | — | `app/main.py` (`get_published_list`) |
| 5 | **Icon vocabulary overhaul + My Notes visibility filter** — globe = published list link; unlock = public; folder = My Notes (book/notebook icon removed everywhere, reserved for future); My Notes page gets All/unlock/person/eye filter bar; client-side filtering in `initNotes()`; visibility badge in note card title row | v52 / v46 | `notes.html`, `published.html`, `share.html`, `index.html`, `results.html`, `app.js` (`initNotes`, `initPublished`, `showEditBtn`), `style.css` (`.sp-vis-status`) |
| 6 | **Nav refinements** — My Notes removed from hamburger (Settings + Sign out only); My Notes icon header-right on index/results; published-list globe on notes header; note cards get Edit/Published action strip; share corner buttons horizontal row; globe links to published list; published page shows My Notes + Home cluster for logged-in users | v46 / v43 | `index.html`, `results.html`, `notes.html`, `settings.html`, `share.html`, `published.html`, `app.js` (`showApp`, `initNotes`, `initPublished`, `showEditBtn`), `style.css` (`.header-right`, `.hdr-icon-btn`, `.note-card-actions`, `.sp-corner-btns`, `.pub-nav-btns`, `.sp-corner-btn`, `.sp-vis-link`) |
| 2 | **UI polish** — hamburger nav (Settings / Sign out) top-left on all app pages; My Notes page switched to card-grid layout matching published list; home icon top-right on app pages, fixed corner on share/published for logged-in users; tagline removed; "Import images and files" / "Scan Files" copy; instructions hint text removed | v44 / v41 | `index.html`, `notes.html`, `results.html`, `settings.html`, `share.html`, `published.html`, `app.js` (`initHamburger`, `initNotes` card rendering), `style.css` (`.app-header`, `#site-nav`, `.hamburger-btn`, `.nav-menu`, `.home-btn`, `.sp-home-btn`) |
| 2 | **PWA support** — installable on Android (install banner) and iOS (Add to Home Screen, standalone display, no browser chrome). Minimal pass-through service worker; no offline caching yet | v43 | `manifest.json`, `sw.js`, `icons/icon-192.png`, `icons/icon-512.png`, `app.js` (service worker registration), all six HTML files (manifest link + theme-color) |
| 2 | **OG link previews** — share page now server-side renders OG + Twitter Card meta tags. Public notes: real title, summary excerpt, hero image (`summary_large_image`). Restricted/not-found notes: generic "ReadWrite" / "Sign in" branding, no image | — | `app/main.py` (`share_page_route`) |
| 3 | **Fix: OG image URL in Railway proxy** — `request.base_url` returned internal host; fixed by reading `X-Forwarded-Proto`/`X-Forwarded-Host` headers to build correct public HTTPS origin | — | `app/main.py` (`share_page_route`) |
| 4 | **Share button on share page** — upload/share icon in top-right `.sp-corner-btns`, visible to all visitors. Triggers native device share sheet (`navigator.share`) on mobile; clipboard copy with "Copied!" feedback on desktop | v42 | `share.html` (`#sp-share-btn`), `app.js` (`initShare`), `style.css` (`.sp-share-btn`) |
| 5 | **Friendly URL slugs** — published notes get a human-readable slug auto-generated from title (e.g. `/share/my-note-title`). Editable in publish panel with live URL preview. Old UUID links still work. Deduplication appends `-2`/`-3` | v42 | `app/db.py` (`slug` col, `_slugify`, `_make_slug`, `get_note_by_slug`, `publish_note`), `app/main.py` (slug fallback in share routes), `results.html` (`#pub-slug`), `app.js` (`slugify`, `savePublishOptions`, `showShareLink`, `restorePublishOptions`) |
| 6 | **Internal links open in same tab** — removed `target="_blank"` from share URL display, published list URL display, and "↗ Published page" badge. GPS map, PDF blob tile, and auto-linked markdown URLs keep `target="_blank"` | v41 | `results.html`, `settings.html`, `app.js` |
| 7 | **Published list: image auth fix + owner features** — restricted images on published list pre-fetched with Bearer token → blob URL. Owner sees visibility icon badge on each card and All/globe/person/eye filter bar above search | v40 | `app.js` (`initPublished`), `app/db.py` (`list_published_notes` returns `visibility`), `app/main.py` (optional auth on `/api/published/{list_token}`), `published.html` |
| 8 | **Magazine template two-tone logo** — "Write" span in `#999`, matching the bold template | v39 | `style.css` |
| 9 | **Share page: image auth fix + owner UI** — restricted images pre-fetched with Bearer token → blob URL. Owner sees pencil edit button + visibility icon (globe/person/eye) in top-right corner. Clerk loaded async for owner detection | v38 | `app.js` (`initShare`, `showEditBtn`), `share.html` (`.sp-corner-btns`) |
| 10 | **Visibility access control on published notes** — `visibility` field (`public`/`logged_in`/`me`) on notes; enforced on `GET /api/share/{token}` and `GET /api/share/{token}/images/{position}` | v35 | `app/main.py`, `app/db.py` (`visibility` col), `results.html` (`#pub-visibility`), `app.js` |
| 11 | **Prev/next navigation on share page** — "← Older" / "Newer →" links between published notes; `get_adjacent_published_notes()` in db.py | v35 | `app/db.py`, `app/main.py`, `app.js` (`initShare`), `share.html` |
| 12 | **Date edit on results page** — `scanned_at` field editable; stored to DB; shown as formatted date on results/share | v35 | `results.html`, `app.js`, `app/main.py` |
| 13 | **Additional Notes checkbox in Share panel** — separate checkbox; omitted from output when empty | v34 | `results.html`, `app.js` |
| 14 | **Fix: Additional Notes card always visible** — card shown from first scan; users can add notes without instructions | v33 | `app.js` |
| 15 | **Fix: single-image share page full width** | v32 | `app.js` |
| 16 | **Fix: hero image natural aspect ratio** | v31 | `style.css` |
| 17 | **Fix: share page hero + thumbnails for multi-image notes** | v30 | `app.js`, `style.css` |
| 18 | **EasyMDE WYSIWYG editor** — Summary/Transcription/Additional Notes use EasyMDE on edit | v29 | `results.html`, `app.js`, `style.css` |
| 19 | **Fix: published list excluded-image filtering + markdown rendering** | v28 | `app/db.py`, `app.js`, `style.css` |
| 20 | **Fix: text edits persist on publish actions** — `savePublishOptions()` spreads `currentTextFields()` | v27 | `app.js` |
| 21 | **Published list hero layout** | v26 | `app.js`, `app/db.py`, `published.html`, `style.css` |
| 22 | **Delete individual image** — `×` button; `DELETE /api/notes/{id}/files/{position}` | v26 | `app/main.py`, `app.js`, `style.css` |
| 23 | **Add images to saved note** — "+ Add images" button; `POST /api/notes/{id}/files` | v26 | `app/main.py`, `app/db.py`, `app.js` |
| 24 | **Per-image publish exclusion** — "Exclude" toggle; `publish_options.excludedImages` | v25 | `app.js`, `style.css` |
| 25 | **Auto-link URLs in text** | v25 | `app.js` |
| 26 | **Settings page** (`/settings`) — template, logo, story list title, list visibility | v21 | `settings.html`, `app.js`, `app/db.py`, `app/main.py` |
| 27 | **Published list page** (`/published/{list_token}`) | v21 | `published.html`, `app.js`, `app/main.py` |

---

## Publish / share architecture

### Global settings (per user, `user_settings` table)
- `template` — minimal / bold / magazine
- `logo_on` — show ReadWrite logo on published pages
- `story_list_title` — heading on the published list page
- `list_public` — whether `/published/{list_token}` is publicly accessible
- `list_token` — stable UUID for the published list URL

### Per-note options (`publish_options` JSON column + `notes` columns)
- `showImages`, `showSectionTitles`, `showSummary`, `showTranscription`, `showAdditional`
- `imagePosition` — top / after-summary / after-transcription / bottom
- `includeInList` — whether this note appears on the published list
- `excludedImages` — array of image positions hidden from the share page
- `notes.visibility` — `public` / `logged_in` / `me`
- `notes.slug` — human-readable URL slug (auto from title, user-editable in publish panel)

### Share URL resolution
`GET /api/share/{token}` tries UUID share_token first, then slug fallback. This means old UUID links always work, and new slug-based URLs work transparently. The displayed URL uses the slug when available.

### `savePublishOptions()` contract
Sends text fields (`title`, `summary`, etc.) + `publish_options` + `visibility` + `slug` in one PUT so no text edits are lost when using publish actions.

---

## Image management

- Images stored at `VOLUME_PATH/notes/{note_id}/{position}.jpg` (or `.pdf`)
- `POST /api/notes/{id}/files` — add images to an existing saved note
- `DELETE /api/notes/{id}/files/{position}` — remove a single image
- `GET /api/share/{token}/images/{position}` — serves images on share/published pages; enforces visibility; also resolves slug as token
- `GET /api/notes/{id}/files/{position}` — auth'd endpoint for My Notes / results view
- **Restricted image auth**: `<img>` tags can't send `Authorization` headers. For `logged_in`/`me` notes, `initShare()` and `initPublished()` pre-fetch each image via `fetch()` with Bearer token, convert to `URL.createObjectURL()` blob, set as `img.src`.

---

## Known open items (Railway config — not code)

1. **`DATABASE_URL` / `MYSQL_URL`** must be a full connection string — `mysql://user:pass@host:port/db`.
2. **Railway Volume** must be mounted at `/data` with `VOLUME_PATH=/data`. If absent, images are lost on redeploy.

---

## End-to-end verification checklist

1. Deploy logs show no `[db] … Falling back to SQLite` warning.
2. Sign in → scan a photo → EXIF toggle appears under thumbnail.
3. Save note → "+ Add images" button appears immediately.
4. Open saved note → `×` on thumbnail → image removed.
5. "Exclude" on thumbnail → publish → share page hides that image.
6. Publish a note → share URL shows friendly slug (e.g. `/share/my-note-title`), not UUID.
7. Navigate to the old UUID URL (`/share/{uuid}`) → still opens the note correctly.
8. Edit slug in publish panel → save → displayed URL updates to custom slug.
9. Share button on share page: on mobile triggers native share sheet; on desktop copies URL and briefly shows "Copied!".
10. Share button visible in incognito (not owner).
11. Publish two notes with the same title → second slug gets `-2` suffix.
12. Set visibility to "Logged in" → open share URL in incognito → auth wall shown → sign in → images load.
13. Owner share page: pencil edit button + visibility icon appear (not shown to other visitors).
14. Published list owner: visibility badge on each card, filter bar visible; anonymous visitor sees neither.
15. Edit title → Republish (without "Save edits") → share page shows updated title.
16. `/settings` → set template, logo, list title → save → published list and share pages reflect changes.
17. Published list URL in incognito → cards shown with hero image, search works, clicking opens share page.
18. "Include in published list" unchecked → Save options → note disappears from list.
19. Prev/next links on share page navigate between published notes.
20. My Notes → thumbnails and "↗ Published page" badge for published notes; clicking badge opens in same tab.
21. Paste a public share URL into iMessage or Slack → preview card shows note title, summary excerpt, and hero image.
22. My Notes visibility filter: click unlock/person/eye → list narrows to published notes of that visibility; click "All" → all notes shown.
23. Published list in incognito → only `public` notes visible; `logged_in`/`me` notes absent entirely.
24. Publish a new note → visibility defaults to "Me only" without any user action.
25. Home page header (signed in) → globe icon appears to left of folder icon; clicking it opens the published list.
26. Upload a photo of an object (not text) → scan returns descriptive title + analytical summary; transcription is empty or contains only visible labels. No "this is not a text note" language.
