# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-21.

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-busters: **`style.css?v=51`**, **`app.js?v=57`** across eight HTML files.

`landing.html` is live at `/landing` — static marketing page, no auth required, self-contained CSS.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 0 | **Infinite scroll** — My Notes, Notebooks page, and Published list now render 20 items at a time and append the next 20 as the user scrolls near the bottom, via an IntersectionObserver sentinel div (`.load-sentinel`). All note data is fetched in one request; client-side search/filter/visibility still works across the full dataset. `createNoteCard` / `appendNoteCards` pattern in `initNotes`; `createNbCard` / `appendNbCards` in `initNotebooks`; `createPubCard` / `appendPubCards` in `initPublished`. | v51 / v57 | `app.js`, `style.css` (`.load-sentinel`) |
| 1 | **Pre-scan thumbnails** — after selecting files on the home screen, 72×72 image thumbnails (object URLs) and PDF placeholder tiles appear below the file count. Each tile has an × remove button. Removing clears the slot from `selectedFiles` and re-renders. | v51 / v57 | `app.js` (`renderThumbs`), `index.html` (`#pre-scan-thumbs`), `style.css` (`.pre-scan-*`) |
| 2 | **10-file scan limit** — `POST /api/scan` returns HTTP 400 if more than 10 files are submitted. Frontend enforces the same cap in `addFiles()` and shows an inline error. | v51 / v57 | `app/main.py` (`scan_notes`), `app.js` (`addFiles`, `MAX_FILES`) |
| 3 | **Notes assignment panel on Notebooks page** — each notebook card has a checkmark button that toggles an inline panel. The panel lazy-loads all notes (stored in `allNotes`; loaded once per page visit), shows a search input, and renders a scrollable checklist with notes-in-notebook listed first. Toggling a checkbox immediately calls `PUT /api/notes/{id}/notebooks` and updates the live note count. | v50 / v56 | `app.js` (`toggleNotesPanel` inside `initNotebooks`), `style.css` (`.nb-notes-panel`, `.nb-notes-checklist`, `.nb-btn-active`) |
| 4 | **Notebook filter on published list** — a notebook dropdown appears below the search bar on the published list page. Always visible to the owner; optionally visible to all visitors via a new Settings toggle ("Show notebook filter to all visitors"). The API includes `notebooks` (published notebooks only) and `notebook_ids` per note. Client-side filtering in `initPublished`. | v50 / v56 | `published.html` (`#pub-notebook-filter`), `settings.html` (`#setting-notebook-filter`), `app.js` (`initPublished`, `initSettings`), `app/main.py` (`get_published_list`), `app/db.py` (`list_published_notebooks`, `show_notebook_filter` column + migration) |
| 5 | **Help page + icon guide** — `/help` route serves `help.html`, a full user guide covering scanning, My Notes, notebooks, publishing, settings, and an icon reference table. Help link (question-circle icon) added as the first item in the hamburger nav-menu on all five app pages. `initHelp()` in `app.js` loads Clerk so the sign-out button works without enforcing an auth wall on the guide. | v48 / v54 | `help.html` (new), `app/main.py` (`GET /help` route), `app.js` (`initHelp`, router branch), `style.css` (`.help-*`, `.icon-legend*` classes), all app HTML files (hamburger Help link) |
| 6 | **No-cache HTML middleware** — FastAPI `StaticFiles` and `FileResponse` apply heuristic HTTP caching to HTML without an explicit `Cache-Control` header; iOS PWA installs were serving stale HTML after deploys. One middleware added after `app = FastAPI()` sets `Cache-Control: no-cache` on all `text/html` responses. Browser still revalidates via ETags (304 when unchanged). | — | `app/main.py` (`no_cache_html` middleware) |
| 7 | **Globe icon on Notebooks page** — `#pub-list-btn` added to `notebooks.html` header-right (hidden by default); `initNotebooks()` fetches `/api/settings` after auth to get `list_token` and reveals the button. | v48 / v54 | `notebooks.html`, `app.js` (`initNotebooks`) |
| 3 | **Notebook categorization** — notes can belong to multiple notebooks (many-to-many). Notebooks page (`/notebooks`) lists all notebooks with note counts; create/rename/delete inline. Notebook book icon added to all app page headers. My Notes page gains a notebook filter dropdown below the search bar (server-filtered via `?notebook_id=`). Results page shows a Notebooks card after saving — checkboxes for all notebooks, toggled immediately via `PUT /api/notes/{id}/notebooks`. Existing notes default to no notebooks with no migration required (join-table design). | v47 / v53 | `notebooks.html` (new), `app/db.py` (`notebooks` + `note_notebooks` tables, 6 new functions), `app/main.py` (6 new routes), `app.js` (`initNotebooks`, `loadNotebooksCard`, `initNotes` notebook filter), `notes.html`, `results.html`, `index.html`, `settings.html`, `published.html`, `style.css` (notebook styles) |
| 1 | **Landing page** — public marketing page at `/landing`; hero with app mockup, how-it-works steps, before/after example, 6-feature grid, testimonials, CTA. Self-contained inline CSS matching design tokens. No explicit route needed — served by the `StaticFiles` mount (`html=True`). | — | `landing.html` |
| 1 | **Adaptive scan prompt** — non-text images (photos, objects, scenes) now get analytical description in `summary` + any visible labels in `transcription` instead of refusal | — | `app/main.py` (`SCAN_PROMPT`) |
| 2 | **Publish visibility default → "Me only"** — new notes default to private; user must opt in to share publicly | — | `results.html` (`#pub-visibility` select) |
| 3 | **Globe button on home page** — globe icon (links to published list) added to `#header-right` left of the folder icon; hidden until settings confirm `list_token` exists | v52 | `index.html`, `app.js` (`initIndex`) |
| 4 | **Security fix: restricted notes hidden from public published list** — `logged_in`/`me` notes no longer shown to unauthenticated or non-owner viewers on `/api/published/{list_token}` | — | `app/main.py` (`get_published_list`) |
| 5 | **Icon vocabulary overhaul + My Notes visibility filter** — globe = published list link; unlock = public; folder = My Notes (book/notebook icon removed everywhere, reserved for future); My Notes page gets All/unlock/person/eye filter bar; client-side filtering in `initNotes()`; visibility badge in note card title row | v52 / v46 | `notes.html`, `published.html`, `share.html`, `index.html`, `results.html`, `app.js` (`initNotes`, `initPublished`, `showEditBtn`), `style.css` (`.sp-vis-status`) |
| 6 | **Nav refinements** — My Notes removed from hamburger (Settings + Sign out only); My Notes icon header-right on index/results; published-list globe on notes header; note cards get Edit/Published action strip; share corner buttons horizontal row; globe links to published list; published page shows My Notes + Home cluster for logged-in users | v46 / v43 | `index.html`, `results.html`, `notes.html`, `settings.html`, `share.html`, `published.html`, `app.js` (`showApp`, `initNotes`, `initPublished`, `showEditBtn`), `style.css` (`.header-right`, `.hdr-icon-btn`, `.note-card-actions`, `.sp-corner-btns`, `.pub-nav-btns`, `.sp-corner-btn`, `.sp-vis-link`) |
| 7 | **UI polish** — hamburger nav (Settings / Sign out) top-left on all app pages; My Notes page switched to card-grid layout matching published list; home icon top-right on app pages, fixed corner on share/published for logged-in users; tagline removed; "Import images and files" / "Scan Files" copy; instructions hint text removed | v44 / v41 | `index.html`, `notes.html`, `results.html`, `settings.html`, `share.html`, `published.html`, `app.js` (`initHamburger`, `initNotes` card rendering), `style.css` (`.app-header`, `#site-nav`, `.hamburger-btn`, `.nav-menu`, `.home-btn`, `.sp-home-btn`) |
| 8 | **PWA support** — installable on Android (install banner) and iOS (Add to Home Screen, standalone display, no browser chrome). Minimal pass-through service worker; no offline caching yet | v43 | `manifest.json`, `sw.js`, `icons/icon-192.png`, `icons/icon-512.png`, `app.js` (service worker registration), all six HTML files (manifest link + theme-color) |
| 9 | **OG link previews** — share page now server-side renders OG + Twitter Card meta tags. Public notes: real title, summary excerpt, hero image (`summary_large_image`). Restricted/not-found notes: generic "ReadWrite" / "Sign in" branding, no image | — | `app/main.py` (`share_page_route`) |
| 10 | **Fix: OG image URL in Railway proxy** — `request.base_url` returned internal host; fixed by reading `X-Forwarded-Proto`/`X-Forwarded-Host` headers to build correct public HTTPS origin | — | `app/main.py` (`share_page_route`) |
| 11 | **Share button on share page** — upload/share icon in top-right `.sp-corner-btns`, visible to all visitors. Triggers native device share sheet (`navigator.share`) on mobile; clipboard copy with "Copied!" feedback on desktop | v42 | `share.html` (`#sp-share-btn`), `app.js` (`initShare`), `style.css` (`.sp-share-btn`) |
| 12 | **Friendly URL slugs** — published notes get a human-readable slug auto-generated from title (e.g. `/share/my-note-title`). Editable in publish panel with live URL preview. Old UUID links still work. Deduplication appends `-2`/`-3` | v42 | `app/db.py` (`slug` col, `_slugify`, `_make_slug`, `get_note_by_slug`, `publish_note`), `app/main.py` (slug fallback in share routes), `results.html` (`#pub-slug`), `app.js` (`slugify`, `savePublishOptions`, `showShareLink`, `restorePublishOptions`) |
| 13 | **Internal links open in same tab** — removed `target="_blank"` from share URL display, published list URL display, and "↗ Published page" badge. GPS map, PDF blob tile, and auto-linked markdown URLs keep `target="_blank"` | v41 | `results.html`, `settings.html`, `app.js` |
| 14 | **Published list: image auth fix + owner features** — restricted images on published list pre-fetched with Bearer token → blob URL. Owner sees visibility icon badge on each card and All/globe/person/eye filter bar above search | v40 | `app.js` (`initPublished`), `app/db.py` (`list_published_notes` returns `visibility`), `app/main.py` (optional auth on `/api/published/{list_token}`), `published.html` |
| 15 | **Magazine template two-tone logo** — "Write" span in `#999`, matching the bold template | v39 | `style.css` |
| 16 | **Share page: image auth fix + owner UI** — restricted images pre-fetched with Bearer token → blob URL. Owner sees pencil edit button + visibility icon (globe/person/eye) in top-right corner. Clerk loaded async for owner detection | v38 | `app.js` (`initShare`, `showEditBtn`), `share.html` (`.sp-corner-btns`) |
| 17 | **Visibility access control on published notes** — `visibility` field (`public`/`logged_in`/`me`) on notes; enforced on `GET /api/share/{token}` and `GET /api/share/{token}/images/{position}` | v35 | `app/main.py`, `app/db.py` (`visibility` col), `results.html` (`#pub-visibility`), `app.js` |
| 18 | **Prev/next navigation on share page** — "← Older" / "Newer →" links between published notes; `get_adjacent_published_notes()` in db.py | v35 | `app/db.py`, `app/main.py`, `app.js` (`initShare`), `share.html` |
| 19 | **Date edit on results page** — `scanned_at` field editable; stored to DB; shown as formatted date on results/share | v35 | `results.html`, `app.js`, `app/main.py` |
| 20 | **Additional Notes checkbox in Share panel** — separate checkbox; omitted from output when empty | v34 | `results.html`, `app.js` |
| 21 | **Fix: Additional Notes card always visible** — card shown from first scan; users can add notes without instructions | v33 | `app.js` |
| 22 | **Fix: single-image share page full width** | v32 | `app.js` |
| 23 | **Fix: hero image natural aspect ratio** | v31 | `style.css` |
| 24 | **Fix: share page hero + thumbnails for multi-image notes** | v30 | `app.js`, `style.css` |
| 25 | **EasyMDE WYSIWYG editor** — Summary/Transcription/Additional Notes use EasyMDE on edit | v29 | `results.html`, `app.js`, `style.css` |
| 26 | **Fix: published list excluded-image filtering + markdown rendering** | v28 | `app/db.py`, `app.js`, `style.css` |
| 27 | **Fix: text edits persist on publish actions** — `savePublishOptions()` spreads `currentTextFields()` | v27 | `app.js` |
| 28 | **Published list hero layout** | v26 | `app.js`, `app/db.py`, `published.html`, `style.css` |
| 29 | **Delete individual image** — `×` button; `DELETE /api/notes/{id}/files/{position}` | v26 | `app/main.py`, `app.js`, `style.css` |
| 30 | **Add images to saved note** — "+ Add images" button; `POST /api/notes/{id}/files` | v26 | `app/main.py`, `app/db.py`, `app.js` |
| 31 | **Per-image publish exclusion** — "Exclude" toggle; `publish_options.excludedImages` | v25 | `app.js`, `style.css` |
| 32 | **Auto-link URLs in text** | v25 | `app.js` |
| 33 | **Settings page** (`/settings`) — template, logo, story list title, list visibility | v21 | `settings.html`, `app.js`, `app/db.py`, `app/main.py` |
| 34 | **Published list page** (`/published/{list_token}`) | v21 | `published.html`, `app.js`, `app/main.py` |

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
2. Visit `/landing` → landing page renders (hero, steps, features, CTA); no sign-in required.
3. Sign in → scan a photo → EXIF toggle appears under thumbnail.
4. Save note → "+ Add images" button appears immediately.
5. Open saved note → `×` on thumbnail → image removed.
6. "Exclude" on thumbnail → publish → share page hides that image.
7. Publish a note → share URL shows friendly slug (e.g. `/share/my-note-title`), not UUID.
8. Navigate to the old UUID URL (`/share/{uuid}`) → still opens the note correctly.
9. Edit slug in publish panel → save → displayed URL updates to custom slug.
10. Share button on share page: on mobile triggers native share sheet; on desktop copies URL and briefly shows "Copied!".
11. Share button visible in incognito (not owner).
12. Publish two notes with the same title → second slug gets `-2` suffix.
13. Set visibility to "Logged in" → open share URL in incognito → auth wall shown → sign in → images load.
14. Owner share page: pencil edit button + visibility icon appear (not shown to other visitors).
15. Published list owner: visibility badge on each card, filter bar visible; anonymous visitor sees neither.
16. Edit title → Republish (without "Save edits") → share page shows updated title.
17. `/settings` → set template, logo, list title → save → published list and share pages reflect changes.
18. Published list URL in incognito → cards shown with hero image, search works, clicking opens share page.
19. "Include in published list" unchecked → Save options → note disappears from list.
20. Prev/next links on share page navigate between published notes.
21. My Notes → thumbnails and "↗ Published page" badge for published notes; clicking badge opens in same tab.
22. Paste a public share URL into iMessage or Slack → preview card shows note title, summary excerpt, and hero image.
23. My Notes visibility filter: click unlock/person/eye → list narrows to published notes of that visibility; click "All" → all notes shown.
24. Published list in incognito → only `public` notes visible; `logged_in`/`me` notes absent entirely.
25. Publish a new note → visibility defaults to "Me only" without any user action.
26. Home page header (signed in) → globe icon appears to left of folder icon; clicking it opens the published list.
27. Upload a photo of an object (not text) → scan returns descriptive title + analytical summary; transcription is empty or contains only visible labels. No "this is not a text note" language.
28. Home page (signed in) → book/notebook icon visible in header; clicking opens `/notebooks`.
29. `/notebooks` → create a notebook → it appears with note count 0; rename inline → title updates; delete → removed.
30. Save a scan → Notebooks card appears below the publish card; checkboxes for all notebooks shown; check one → immediately saved (no separate save button).
31. Open an old note (pre-notebook feature) → Notebooks card shows with all notebooks unchecked; can assign to notebooks.
32. My Notes → notebook filter dropdown visible below search bar; select a notebook → list narrows to only notes in that notebook; select "All notebooks" → all notes shown.
33. Click a notebook title on `/notebooks` → navigates to My Notes with that notebook pre-selected in the filter.
34. All app pages: hamburger menu contains Help → Settings → Sign out (in that order).
35. Visit `/help` without signing in → help page renders fully; no sign-in wall.
36. `/help` icon reference table shows all icons (menu, notebooks, my notes, home, globe, unlock, person, eye, pencil, share, help) with names and descriptions.
37. `/notebooks` header-right: globe icon appears (linked to published list) after sign-in when user has a list_token; hidden before auth or if no list_token.
38. After a deploy, reload any page on the iOS PWA → browser revalidates HTML; no stale cached version served. Network tab shows `Cache-Control: no-cache` on HTML responses.
39. Home page: select 11 images → error "Maximum 10 files per scan" appears; only 10 files accepted. Select 5 → thumbnails appear below file count, each with × remove. Remove one → count updates, thumbnail gone.
40. Home page: select a mix of images and a PDF → PDF tile shows "PDF" placeholder; image tiles show actual thumbnail previews.
41. My Notes: if >20 notes exist, first 20 cards render immediately; scrolling to the bottom appends the next 20 (and so on). Search and filter still work across the full dataset.
42. Notebooks page: if >20 notebooks exist, same progressive render applies.
43. Published list: same progressive render; notebook + search + visibility filters apply to the full in-memory dataset.
44. Notebooks page: click the checkmark button on a notebook → notes panel opens with search input and scrollable checklist; notes already in the notebook appear first (checked). Toggle a checkbox → note count on the card updates immediately. Click the checkmark button again → panel collapses.
45. Published list (owner): notebook filter dropdown visible; selecting a notebook narrows the list client-side.
46. Published list (visitor, notebook filter setting ON): notebook filter dropdown visible; selecting narrows the list.
47. Published list (visitor, notebook filter setting OFF): notebook filter dropdown hidden.
48. Settings page: "Notebook filter" checkbox present; save → published list reflects the change for visitors.
