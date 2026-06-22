# HANDOVER — ReadWrite continuity snapshot

Live state for picking up work in a fresh thread. Durable project docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-22 (updated same session).

---

## Where we are

Everything is merged to **`main`**. Railway auto-deploys from main. No open feature branches.

Cache-busters: **`style.css?v=58`**, **`app.js?v=69`** across nine HTML files (relative paths: `index.html`, `results.html`, `notes.html`, `settings.html`, `notebooks.html`, `help.html`; absolute paths `/style.css?vN`, `/app.js?vN`: `share.html`, `published.html`). `landing.html` uses self-contained inline CSS — no version bump needed.

`landing.html` is live at `/landing` — static marketing page, no auth required, self-contained CSS.

---

## Features shipped (newest first)

| # | Feature | Version | Key files |
|---|---|---|---|
| 0 | **Eye icon on access code field + random URL slugs by default** — (1) Eye/eye-off toggle button added next to the access code password input in the notebook card form so the owner can see what they're typing. (2) Published note URLs now default to a random 8-char URL-safe slug (`secrets.token_urlsafe(6)`) instead of title-derived. "Use title" button fills the slug input from the current note title as an opt-in. Slug input placeholder updated to "random (auto-generated)". Slug input and button wrapped in a `.pub-slug-row` flex container. Input empty state shows no URL preview (instead of title-derived). Lock/unlock of publish options also disables/enables the "Use title" button. | v58 / v69 | `app/db.py` (`_random_slug`, `publish_note`), `results.html` (`.pub-slug-row` wrapper + `#pub-slug-use-title` button), `app.js` (slug input handler — no title fallback when empty, `#pub-slug-use-title` wired, `lockPublishOptions`/`unlockPublishOptions` disable button, `renderAccessRow` eye icon), `style.css` (`.pub-slug-row`, `.pub-slug-input flex:1`) |
| 0 | **Decouple notebook inclusion from published list + notebook access codes** — (1) New `includeInNotebooks` flag in `publish_options` JSON (independent of `includeInList`); exposed as a separate "Include in notebook(s)" checkbox in the publish card. `list_published_notes()` gains `for_notebook` param: `False` filters by `includeInList` (main feed), `True` filters by `includeInNotebooks` (notebook view). `GET /api/published/{identifier}` determines notebook-vs-feed mode early and calls the right variant. (2) Optional access code (password) per notebook: `access_code_hash VARCHAR(255) NULL` column on `notebooks` table (migration added); PBKDF2-SHA256 hash with random salt, stdlib only. `PUT /api/notebooks/{id}` accepts `access_code` field to set/clear. When a notebook slug URL has a hash, `GET /api/published/{identifier}` requires `X-Notebook-Access-Code` header and returns `403 {"detail":"access_code_required"}` on mismatch. Frontend: gate form renders on 403, stores verified code in `sessionStorage` (session-only), reloads. Notebook cards on `/notebooks` show a lock-icon button + "Access code: none/set" label when public URL is active. | v57 / v68 | `app/db.py` (`access_code_hash` col + migration, `set_notebook_access_code`, `list_notebooks has_access_code`, `get_notebook_by_global_slug`, `list_published_notes for_notebook`), `app/main.py` (`_hash_access_code`, `_verify_access_code`, `get_published_list` access gate + for_notebook, `update_notebook_route` access_code), `results.html` (`#pub-in-notebooks`), `app.js` (`getPublishOptions`, `restorePublishOptions`, `initPublished` gate, `initNotebooks` access code UI), `style.css` (`.nb-access-*`, `.pub-access-*`) |
| 0 | **Five-change batch** — (1) Welcome screen for first-time visitors (`localStorage` flag `rw_seen_welcome`, `#welcome-screen` card in `index.html`, `.welcome-card` CSS); (2) Per-user + global daily scan limits (`global_settings` + `scan_counts` tables, enforced in `POST /api/scan`, admin UI in Advanced card — per-user default 30, global default 500); (3) Edit pen icon for notebook slug (pencil button in `renderSlugRow()` focuses the slug input); (4) Removed duplicate nav items (Home/My Notes/Notebooks/Published list + divider) from `settings.html` hamburger — matches the clean pattern of other pages; (5) Globe icon help text: "Your public published notes feed" → "Your published notes feed". | v56 / v67 | `app/db.py` (`global_settings`, `scan_counts` tables + 4 functions), `app/main.py` (scan limit check, `increment_scan_count`, 2 new routes), `settings.html` (scan limit inputs, cleaned hamburger), `app.js` (`initSettings` fetch limits + save, `renderSlugRow` edit button, `initIndex` welcome logic), `index.html` (`#welcome-screen`), `style.css` (`.welcome-*`), `help.html` (icon text fix) |
| 0 | **Hamburger sign-out z-index fix + help page update** — Added `z-index: 500` to `.app-header` in `style.css` so the nav-menu (`.nav-menu { z-index: 200 }`) overlays page content on all pages (was blocked by upload UI on index.html). Help page updated: Notebooks section covers system notebooks, search/sort, and chain-link public URL feature; Publishing section notes notebook context on share page; icon table gains chain-link row. | v55 / v66 | `style.css` (`.app-header z-index`), `help.html` (Notebooks, Publishing sections + icon table) |
| 0 | **Fix notebook public URLs: friendly URLs + server-side filtering** — `GET /api/published/{identifier}` now resolves the identifier as a UUID list_token first, then as a global notebook slug (via `get_notebook_by_global_slug()`). Notebook card URLs show `/published/{slug}` (not `/published/{uuid}?nb=slug`). Notes server-filtered to the notebook when resolved via slug. Initial published list render fixed to apply `filteredNotes()` (was rendering all notes ignoring active notebook). Dropdown change updates URL to `/published/{slug}` via `history.replaceState`. | v64 | `app/db.py` (`get_notebook_by_global_slug`), `app/main.py` (`get_published_list` identifier resolution + server filter), `app.js` (`renderSlugRow` URL, `initPublished` initial render + dropdown handler) |
| 0 | **Fix notebook URL disable + icon** — Disable URL button was broken (disabled state never re-enabled on success; `confirm()` not checked before disabling). Fixed: button disabled at top, re-enabled at end of both success and failure paths. Globe icon replaced with chain-link icon (globe is reserved for "publicly available content" in the app icon vocabulary). | v65 | `app.js` (`createNbCard` linkBtn) |
| 0 | **Notebook public URL redesign** — Notebooks start with no public URL. Chain-link button on each card: grey = disabled, accent = active. Clicking grey enables (auto-generates slug); clicking active disables with confirm (clears slug). URL row shows `/published/{slug}` link, inline editable slug input (auto-saves 800ms after typing), and copy button. Backend: `update_notebook` handles `slug=""` → NULL; `create_notebook` no longer auto-generates slug. | v63 / v54 | `app/db.py` (`update_notebook` slug="" handling, `create_notebook`), `app.js` (`createNbCard` globe toggle + `renderSlugRow`), `style.css` (`.nb-globe-active`, `.nb-slug-input`) |
| 0 | **Notebook URL slugs + notebook-filtered published list header** — `GET /published/{list_token}?nb={slug}` filters the list to that notebook and shows notebook title as page header. Changing the dropdown updates title and URL live via `history.replaceState`. Backend: `slug` column on `notebooks` + migration; `_make_notebook_slug()`; `get_notebook_by_slug()`; `activeNotebook` in published list API response. | v62 / v53 | `app/db.py` (`slug` col, `_make_notebook_slug`, `get_notebook_by_slug`, `list_notebooks`, `list_published_notebooks`, `update_notebook`), `app/main.py` (`update_notebook_route` + `get_published_list` `?nb=`), `app.js` (`initPublished`, `initNotebooks` `window._pubListToken`), `style.css` (`.nb-slug-row`, `.nb-slug-link`) |
| 0 | **Published list sort order** — Notes ordered by `scanned_at desc` instead of `created_at`; editing a note's date now changes its position in the list. | v61 | `app/db.py` (`list_published_notes`) |
| 0 | **Nav icons in settings + help menus; expanded header-right on settings** — Hamburger nav-menu on `settings.html` and `help.html` now shows Home, My Notes, Notebooks, Published list (globe, hidden until `list_token` confirmed) above a divider, then Help / Settings / Sign out. `settings.html` header-right gains My Notes and Globe icons (previously only had Notebooks + Home). `help.html` header-right gains Globe. | v61 / v52 | `settings.html`, `help.html`, `app.js` (`initSettings`, `initHelp`), `style.css` (`.nav-menu-divider`) |
| 0 | **Custom scan prompt fix + default prompt display** — `SCAN_PROMPT` split into `SCAN_PROMPT_BASE` + `SCAN_PROMPT_JSON_SHAPE`; JSON shape always appended to any prompt so custom prompts can never break Claude's output. New `GET /api/default-scan-prompt` endpoint (auth'd). Advanced settings card now shows a read-only "Default prompt" textarea (populated from API) and a separate optional "Custom prompt" textarea; button relabelled "Clear custom prompt". | v61 | `app/main.py` (`SCAN_PROMPT_BASE`, `SCAN_PROMPT_JSON_SHAPE`, `scan_notes`, new route), `settings.html`, `app.js` (`initSettings`) |
| 0 | **System notebooks** — Four virtual notebooks (Public, Login restricted, Only me, Unpublished) appended to every `GET /api/notebooks` response with live counts. `list_notes()` handles `system:*` notebook IDs for server-side filtering. `set_note_notebooks()` strips system IDs. Frontend renders them as dashed-border cards at the bottom with no edit/delete/add-notes actions; excluded from `loadNotebooksCard` checkboxes on results page. | v61 | `app/db.py` (`_SYSTEM_NOTEBOOKS`, `list_notebooks`, `list_notes`, `set_note_notebooks`), `app.js` (`createNbCard`, `filteredNotebooks`, `loadNotebooksCard`), `style.css` (`.nb-card-system`) |
| 0 | **Notebook search + sort** — Search input and A–Z / Date created sort dropdown above the notebooks list. `filteredNotebooks()` applies client-side; system notebooks always stay at the bottom regardless of sort or search. | v61 / v52 | `notebooks.html`, `app.js` (`filteredNotebooks`, `renderNotebooks`, search/sort wiring), `style.css` (`.nb-controls-row`, `.nb-search-input`, `.nb-sort-select`) |
| 0 | **Admin scan prompt editor** — Settings page shows an "Advanced" card (hidden for all users except `opti66@gmail.com`, gated client-side by Clerk email). Contains a resizable monospace textarea pre-populated with the user's saved prompt, plus a "Reset to default" button that clears it. Saved via a separate "Save Advanced Settings" button. Backend stores the value in `user_settings.scan_prompt` (new TEXT column + migration); `POST /api/scan` uses it instead of the hardcoded `SCAN_PROMPT` constant when non-empty. | v60 | `settings.html`, `app.js` (`initSettings`), `app/db.py` (`scan_prompt` col + migration), `app/main.py` (`scan_notes`) |
| 1 | **Infinite scroll** — My Notes, Notebooks page, and Published list now render 20 items at a time and append the next 20 as the user scrolls near the bottom, via an IntersectionObserver sentinel div (`.load-sentinel`). All note data is fetched in one request; client-side search/filter/visibility still works across the full dataset. `createNoteCard` / `appendNoteCards` pattern in `initNotes`; `createNbCard` / `appendNbCards` in `initNotebooks`; `createPubCard` / `appendPubCards` in `initPublished`. | v51 / v57 | `app.js`, `style.css` (`.load-sentinel`) |
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
- `includeInList` — whether this note appears in the owner's main published feed
- `includeInNotebooks` — whether this note appears in published notebook views (independent of `includeInList`)
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
49. Sign in as `opti66@gmail.com` → Settings page shows an "Advanced" card below Publishing; textarea shows current scan prompt (empty = default). Edit text → Save Advanced Settings → next scan uses the custom prompt. Click "Reset to default" → textarea cleared → next scan reverts to default `SCAN_PROMPT`.
50. Sign in as any other user → Settings page shows no Advanced card.
51. `/notebooks` → each user notebook card shows a globe icon button in the action row; grey globe = no public URL, accent globe = URL active. Clicking grey globe generates a slug and shows the URL row below the card; clicking accent globe (with confirm) removes the URL and hides the row. URL row shows `?nb=<slug>` link, an editable slug input (type to edit; auto-saves 800ms after stopping), and a copy button. New notebooks created without a public URL by default.
52. Navigate to `/published/{list_token}?nb={slug}` → page `<h1>` and browser tab title show the notebook's title, not the user's global story list title; notes list is filtered to that notebook.
53. On the published list page, change the notebook dropdown to a different notebook → page title and URL (`?nb=`) update live without a full page reload; change to "All" → title reverts to global story list title and `?nb=` param removed from URL.
54. Edit a note's scan date to an older value → after save, note moves down in the published list when refreshed; edit to a newer date → note moves up.
55. Visit the home page signed out for the first time (no `rw_seen_welcome` in localStorage) → welcome screen card shown ("Welcome to ReadWrite", body text, "Get Started" button); sign-in widget NOT shown yet. Click "Get Started" → welcome screen hides, sign-in widget appears. On subsequent signed-out visits → welcome screen skipped, sign-in widget shown directly.
56. Sign in as `opti66@gmail.com` → Settings Advanced card shows "Daily scan limits" section with two number inputs (Per-user and Global). Change values → Save Advanced Settings → values persist on next page load. As another user, the Advanced card is hidden entirely (scan limits not visible or editable).
57. `/notebooks` → enable public URL on a notebook (click grey chain-link → URL row appears). URL row shows the link, editable slug input, and copy button. An edit pen icon is visible to the right of the copy button. Click the edit pen → slug input gains focus and is fully selected (ready to type).
58. `/help` → Scan Limits section (or any place referencing the published list feed) reads "Your published notes feed" (not "Your public published notes feed").
59. `settings.html` hamburger menu contains exactly Help → Settings → Sign out (no Home, My Notes, Notebooks, or Published list items above a divider).
60. Publish a note → publish card shows two separate "Include" checkboxes: "Include in published list" and "Include in notebook(s)". Uncheck "Include in notebook(s)" but keep "Include in published list" checked → note still appears in the main feed (`/published/{list_token}`) but disappears from any notebook page (`/published/{nb_slug}`). Uncheck "Include in published list" only → note disappears from the main feed but still appears inside a notebook page it belongs to.
61. `/notebooks` → enable public URL on a notebook. When the notebook card has a public URL active, a lock icon and "Access code: none" label appear. Click the lock icon → inline password input appears. Type a code and click Save → label changes to "Access code: set" and the button gains accent styling. Visit the notebook's public URL (`/published/{nb_slug}`) in an incognito window → access gate shown ("Access code required" form). Enter the wrong code → "Incorrect code" message, input cleared. Enter the correct code → notebook content loads normally. Close and reopen the tab → gate is shown again (sessionStorage cleared). Back in the authenticated session, click the lock icon → clear the code (leave blank + Save) → incognito visit no longer shows the gate.
62. `/published/{list_token}?nb={nb_slug}` (notebook filter via query param on list token URL) → no access gate is shown regardless of whether the notebook has an access code set. The gate only applies to direct notebook slug URLs (`/published/{nb_slug}`).
