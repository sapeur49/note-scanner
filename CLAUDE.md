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

No build step. QA is done via `test.html` in the browser (self-contained, no API key needed). Local SQLite DB is auto-created at `readwrite_local.db` when no `DATABASE_URL`/`MYSQL_URL` is set.

**Live state**: `HANDOVER.md` is a session-to-session snapshot (features shipped, open Railway config items, end-to-end checklist). Read it at the start of a new thread to orient quickly.

**Cache busting**: `?v=N` query strings on `app.js` and `style.css`. Bump when deploying JS/CSS changes — JS and CSS versions can differ (currently `style.css?v=54`, `app.js?v=65`). Update all nine HTML files: `index.html`, `results.html`, `notes.html`, `settings.html`, `notebooks.html`, `help.html` use relative paths; `share.html` and `published.html` use absolute paths (`/style.css?v=N`, `/app.js?v=N`) because their URL paths have two segments, which would break relative resolution. `landing.html` uses self-contained inline CSS — no version bump needed.

---

## Deployment

Push to `main` → Railway auto-deploys (~1-2 min). `Procfile` defines the start command. The `.github/workflows/` files and root `SCAN_ENDPOINT.py` are unused leftovers.

**Git branch workflow**: Always `git fetch origin main` then `git checkout -b <branch> origin/main` before making changes. Apply changes directly on the new branch — never stash/pop across branch switches, as this causes repeated version-number conflicts with squash-merged main.

**Railway env vars required:**
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint, e.g. `https://<clerk-domain>/.well-known/jwks.json` |
| `CLERK_ISSUER` | Optional — Clerk issuer URL for stricter JWT validation |
| `DATABASE_URL` or `MYSQL_URL` | Full `mysql://user:pass@host:port/db` connection string. Falls back to SQLite if absent/malformed. |
| `VOLUME_PATH` | Path to Railway Volume mount point, e.g. `/data`. Saved file attachments land at `<VOLUME_PATH>/notes/<note_id>/`. |

---

## Architecture

```
app/main.py        FastAPI: POST /api/scan + CRUD /api/notes + notebooks CRUD + publish/share/settings/published routes + static file mount
app/db.py          SQLAlchemy Core persistence — MySQL prod / SQLite dev fallback
app/auth/verify.py JWT verification via Clerk JWKS (PyJWT + PyJWKClient)
manifest.json      PWA web app manifest (name, icons, theme_color, display: standalone)
sw.js              Service worker — pass-through fetch only; no offline caching yet
icons/             PWA icons: icon-192.png, icon-512.png (placeholder "RW" tiles; swap for real art)
landing.html       Public marketing landing page — hero, how-it-works, before/after example, features, testimonials, CTA; self-contained CSS; served at /landing by the static file mount
index.html         Upload UI (sign-in wall + app div + Notebooks + My Notes + Settings links)
results.html       Scan results: image strip, summary, transcription, additional notes, notebooks card, share panel, save/update/delete/publish
notes.html         My Notes list — visibility filter, search, notebook filter dropdown, browse, open saved notes (thumbnails + published badge)
notebooks.html     Notebooks management page — list notebooks (user + system), create/rename/delete, search, sort (A–Z / date), click through to filtered notes list; globe icon in header
help.html          User help guide — icon reference table, scanning, My Notes, Notebooks, Publishing, Settings sections; accessible without auth; served at /help
share.html         Public share page — route is server-side rendered (OG/Twitter Card meta tags injected for social previews); Clerk loaded async for owner detection; template/logo from owner settings; share button (all visitors) + owner visibility icon + edit button (top-right corner)
settings.html      Settings page — story list title, template, logo, published list visibility (auth'd)
published.html     Public published notes list — /published/{list_token}; Clerk loaded async (non-blocking) for owner detection; owner sees visibility icon per card + filter bar above search
app.js             All frontend logic — auth, thumbnails, scan POST, sessionStorage, EXIF display,
                   lightbox carousel, edit, share, notes CRUD, publish/unpublish, initShare(),
                   initSettings(), initPublished(), initNotebooks(), initHelp()
style.css          Shared styles, CSS variables, auto light/dark mode, 3 share page templates
test.html          Browser-based QA harness
```

**Key decisions:**
- `ANTHROPIC_API_KEY` stays server-side only; never sent to browser
- All files sent in one Claude API call (multipart/form-data); images as `image` blocks, PDFs as `document` blocks
- Client-side image resizing before POST: 150px/JPEG-0.5 thumbnails → `rw_images`, 1500px/JPEG-0.85 lightbox images → `rw_lightbox`, both in `sessionStorage`; PDFs get a placeholder tile
- Results stored as `rw_results` in `sessionStorage`; `results.html` reads and renders them
- Summary and transcription are rendered as HTML via `renderMarkdown()`, not raw text

**sessionStorage keys** (shared contract between `app.js` and `results.html`):
| Key | Contents |
|---|---|
| `rw_images` | JSON array of 150px JPEG data-URLs (thumbnails, one per file) |
| `rw_lightbox` | JSON array of 1500px JPEG data-URLs (full-res, one per file) |
| `rw_results` | JSON object — the full `/api/scan` response (includes `file_exif`) |
| `rw_scan_id` | Saved note ID — set when `results.html?id=…` loads a saved note |

---

## Auth (Clerk — active)

Sign-in is enforced client-side via the Clerk JS SDK loaded from the Clerk domain (not a CDN):
```html
<script src="https://<clerk-domain>/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key="pk_test_..."></script>
```
Using the official Clerk domain (not jsdelivr) is required for Google OAuth to appear.

The scan `fetch` sends `Authorization: Bearer <token>` where token = `await window.Clerk.session.getToken()`. The backend's `require_user` dependency (`app/auth/verify.py`) validates the JWT via JWKS.

**Auth state changes** are handled via `window.Clerk.addListener(({ user }) => ...)` in `initIndex()`. Do not rely solely on a one-time `window.Clerk.user` check.

To update the Clerk publishable key: change `data-clerk-publishable-key` in `index.html`, `results.html`, and `notes.html`.

---

## Backend: app/main.py

- `MODEL` constant selects the Claude model — currently `claude-sonnet-4-6`; `max_tokens=4096`
- The scan prompt is split into `SCAN_PROMPT_BASE` (the instructions) and `SCAN_PROMPT_JSON_SHAPE` (the JSON output requirement). Both are always concatenated before sending to Claude — this prevents custom prompts from accidentally omitting the JSON shape and causing a 502. `SCAN_PROMPT = SCAN_PROMPT_BASE + SCAN_PROMPT_JSON_SHAPE` for reference. The prompt is **adaptive**: text-dominant images get full transcription + summary; primarily visual images (photos, objects, scenes) get an analytical description in `summary` and any visible labels/text in `transcription`.
- `scanned_at` (ISO-8601 UTC) is added server-side; Claude never generates timestamps.

**EXIF extraction** (`_extract_exif` in `app/main.py`):
- Pillow reads two IFDs: the main IFD (Make, Model) and the ExifIFD sub-IFD via `raw.get_ifd(0x8769)` (DateTimeOriginal, FNumber, ExposureTime, ISOSpeedRatings, LensModel). Shooting data is in the sub-IFD, not the main IFD — this is why both must be read.
- GPS is read via `raw.get_ifd(0x8825)` and included in the response as `{"lat": float, "lon": float}`.
- EXIF (camera, date, GPS) is appended to the Claude prompt as `[Photo metadata: taken {dt}; Camera: {make} {model}; Location: {lat}, {lon}]`. GPS is included so Claude can assist with location-based analysis.
- Scan response includes `file_exif`: array (one entry per file, `null` for PDFs/no-EXIF images).
- EXIF per file is also stored inside the `files` JSON column (as an `exif` key on each file entry) when a note is saved.

**Scan response shape:**
```json
{
  "title": "...", "summary": "...", "transcription": "...",
  "scanned_at": "...",
  "additional_notes": "...",  // only present when `instructions` were provided
  "file_exif": [{"Make": "Apple", "Model": "iPhone 15", "DateTimeOriginal": "2024:03:15 14:22:00",
                  "ISOSpeedRatings": 400, "FNumber": 1.8, "ExposureTime": "1/120",
                  "GPS": {"lat": 48.858, "lon": 2.294}}, null]
}
```

**All API routes** (must be registered before the `StaticFiles` mount):
- `POST /api/scan` — multipart/form-data: `files` + optional `instructions`
- `POST /api/notes` — save a scanned note with file attachments
- `GET /api/notes` — list notes for the signed-in user (supports `?q=` search, `?notebook_id=` filter)
- `GET /api/notes/{id}` — fetch a single note (includes `share_token` and `notebook_ids` fields)
- `PUT /api/notes/{id}` — update editable fields: `title`, `summary`, `transcription`, `additional_notes`, `publish_options`, `scanned_at`, `visibility`, `slug` (slugified + deduplicated server-side)
- `DELETE /api/notes/{id}` — delete note + remove volume files + clean up `note_notebooks` rows
- `GET /api/notes/{id}/files/{position}` — serve an attached file (auth'd)
- `POST /api/notes/{id}/files` — upload additional images/PDFs to a saved note; assigns positions continuing from existing max; extracts EXIF (auth'd)
- `DELETE /api/notes/{id}/files/{position}` — delete a single file from a saved note; removes from disk and updates `files` JSON (auth'd)
- `PUT /api/notes/{note_id}/notebooks` — set notebook memberships for a note; body: `{"notebook_ids": [...]}`. Replaces all existing memberships. Verifies note ownership and that all notebook IDs belong to the user (auth'd)
- `POST /api/notes/{id}/publish` — generate/return share token + slug (idempotent, auth'd); returns `{"share_token": "...", "slug": "..."}`
- `DELETE /api/notes/{id}/publish` — revoke share token (auth'd)
- `GET /api/notebooks` — list all notebooks for the signed-in user; returns `[{id, title, note_count}]` (auth'd)
- `POST /api/notebooks` — create a notebook; body: `{"title": "..."}` (auth'd)
- `PUT /api/notebooks/{notebook_id}` — rename a notebook; body: `{"title": "..."}` (auth'd)
- `DELETE /api/notebooks/{notebook_id}` — delete a notebook (notes are unaffected, join rows removed) (auth'd)
- `GET /api/settings` — fetch user settings (auth'd)
- `PUT /api/settings` — upsert user settings; auto-generates `list_token` if absent (auth'd)
- `GET /api/share/{token}` — `token` may be a UUID share token or a slug; tries UUID lookup first, then slug fallback. Returns note JSON + owner settings; checks `visibility`; adds `is_owner: true`; adds `prev_token`/`next_token` for adjacent published notes when the list is public
- `GET /api/share/{token}/images/{position}` — serve a published note image; enforces `visibility` (no auth required for `public`)
- `GET /api/published/{list_token}` — return published notes list + settings; 403 if `list_public != true`; accepts optional `Authorization` header — if the bearer token matches the list owner, adds `isOwner: true` to settings and includes `visibility` on each note; **visibility filtering**: unauthenticated viewers see only `public` notes, authenticated non-owners see `public` + `logged_in`, owners see all
- `GET /share/{token}` — server-side render `share.html` with OG/Twitter Card meta tags injected; public notes get real title, summary excerpt, and hero image URL; restricted/not-found notes get generic ReadWrite branding (no content leaked)
- `GET /settings` — serve `settings.html`
- `GET /published/{list_token}` — serve `published.html` (no auth)
- `GET /notebooks` — serve `notebooks.html` (auth'd by client-side Clerk check)
- `GET /help` — serve `help.html` (no auth required; public documentation)

---

## Publish / Share

A saved note can be published: `POST /api/notes/{id}/publish` generates a stable UUID share token (`notes.share_token`) and a human-readable slug (`notes.slug`). The public share URL is `{origin}/share/{slug}` (falling back to `{origin}/share/{uuid}` if no slug). Old UUID URLs always keep working — the backend tries UUID lookup first, then slug.

`GET /share/{token}` serves `share.html`, which has **absolute** asset paths (`/style.css?v=N`, `/app.js?v=N`) — critical because the URL path `/share/{token}` would make relative paths resolve to `/share/style.css` (404). Same applies to `published.html` and `settings.html`.

`initShare()` in `app.js` fetches `/api/share/{token}`, which now includes the owner's `template`, `logo_on`, and `list_token` (if their published list is public). Template and logo are **global** (from `user_settings`), not per-note. Per-note `publish_options` controls: `showImages`, `showSectionTitles`, `showSummary`, `showTranscription`, `showAdditional`, `imagePosition`, `includeInList`, `excludedImages` (array of positions excluded from the share page).

**Image auth on share/published pages**: `<img>` tags cannot send `Authorization` headers. For notes with `visibility = logged_in` or `me`, `initShare()` and `initPublished()` pre-fetch each image via `fetch()` with `Authorization: Bearer <token>`, convert the response blob to an object URL via `URL.createObjectURL()`, and set that as `img.src`. Public notes use plain `/api/share/{token}/images/{position}` URLs directly.

**OG meta tags**: `GET /share/{token}` injects Open Graph + Twitter Card meta tags server-side before returning `share.html`, so social platforms (Slack, iMessage, X) see real content without executing JS. Public notes: `og:title` = note title, `og:description` = first 160 chars of summary (markdown stripped), `og:image` = first non-excluded image at `/api/share/{token}/images/{pos}`, `twitter:card` = `summary_large_image` (or `summary` when no image). Restricted (`logged_in`/`me`) and not-found notes return generic ReadWrite branding with no image. Origin URL derived from `X-Forwarded-Proto`/`X-Forwarded-Host` headers (Railway proxy) rather than `request.base_url`.

**Share button on share page**: `#sp-share-btn` in `.sp-corner-btns` is visible to all visitors. Uses `navigator.share` (native share sheet on mobile) with clipboard fallback on desktop. Wired in `initShare()` after data loads.

**Owner-only UI on share page**: When `is_owner: true` is returned by the API, `showEditBtn()` in `app.js` shows both the pencil edit button (links to `results.html?id=…`) and a visibility icon (unlock = public, person = logged-in, eye = me-only) in `.sp-corner-btns` top-right.

**Publish panel UX**: When a note is already published, all options are locked/greyed out. "Edit options" button re-enables them, showing "Save options" and "Republish" buttons.

**Published list**: Each user has a stable `list_token` (auto-generated on first settings save). `GET /published/{list_token}` serves the public list page when `list_public = "true"` in `user_settings`. Notes are excluded from the list if `publish_options.includeInList = false`. When the logged-in user is the owner, `initPublished()` re-fetches with auth to get `isOwner: true` — the owner then sees a visibility icon badge on each card and a filter bar (All / unlock / person / eye) above the search input. Restricted-visibility notes are hidden from non-owner/unauthenticated viewers at the API level.

**Settings**: Template (minimal/bold/magazine), logo on/off, story list title, and list visibility are global per-user settings stored in `user_settings` table, managed via `/settings` page.

**Magazine template**: Two-tone logo — "Read" in foreground color, "Write" (`<span>`) in `#999`. Same as the bold template. Controlled by `body[data-template="magazine"] .sp-logo-link span { color: #999; }` in `style.css`.

**Link targets**: Internal navigation links open in the same tab (no `target="_blank"`). Only three link types use `target="_blank"`: GPS map link (external URL), PDF blob tile (`URL.createObjectURL` blob — navigating away would lose page state), and auto-linked bare URLs in user-supplied markdown content.

---

## EXIF Display

`addImageTile(thumbSrc, fullSrc, i, exif)` in `app.js` wraps each image in a `<figure class="thumb-figure">` with a `<details class="exif-details">` toggle underneath. The `<dl class="exif-dl">` is **absolute-positioned** (220px wide) so it floats over adjacent thumbnails when opened — `.thumb-figure` has `position: relative` and `:has(details[open])` bumps its `z-index` to 50.

EXIF date format from cameras is `YYYY:MM:DD HH:MM:SS` — `app.js` converts the colons in the date part to dashes before display.

Each tile also renders:
- **Exclude button** (`.pub-exclude-btn`) — toggles the position in the `excludedImages` Set; serialised into `publish_options.excludedImages` on save/publish. Excluded images are hidden on the share page.
- **Delete button** (`.thumb-delete-btn`, saved mode only) — calls `DELETE /api/notes/{id}/files/{position}`, removes the `<figure>` from the DOM immediately.

**Adding images to a saved note**: `enableAddImages(noteId)` in `app.js` shows `#add-images-row` and wires the file input to `POST /api/notes/{id}/files`. A `dataset.wired` guard prevents double-wiring if called more than once. The function is called in two places: in the saved-mode init branch and after a successful save in fresh mode (so the button appears immediately after first save).

---

## Database: app/db.py

SQLAlchemy Core, same code for MySQL (prod) and SQLite (dev). `_migrate_schema()` runs after `create_all()` and adds new columns via `ALTER TABLE` only if absent — works for both engines. Currently migrates: `share_token`, `publish_options`, `is_published`, `visibility`, `slug` on `notes`.

`files` JSON column stores per-file metadata including `exif` (if available) — no separate EXIF column needed.

`publish_note()` is idempotent (reuses existing token) and auto-generates a slug from the title if none is set. Returns `{"share_token": ..., "slug": ...}`.

Slug helpers: `_slugify(title)` — lowercase, strip non-alnum to hyphens, truncate to 60 chars. `_make_slug(base, user_id, exclude_note_id)` — queries existing slugs for the user and appends `-2`/`-3` suffix on collision. `get_note_by_slug(slug)` — published-note lookup by slug (no auth).

**`user_settings` table** (`create_all` creates it; `show_notebook_filter` added via `_migrate_schema`):
| Column | Type | Purpose |
|---|---|---|
| `user_id` | String(255) PK | Clerk user sub |
| `story_list_title` | String(512) | Heading on published list page |
| `template` | String(32) | `minimal`\|`bold`\|`magazine` — global for all published pages |
| `logo_on` | String(8) | `"true"`\|`"false"` — show ReadWrite logo on published pages |
| `list_public` | String(8) | `"true"`\|`"false"` — controls public access to published list |
| `list_token` | String(36) | Stable UUID; auto-generated on first `upsert_settings()` call |
| `show_notebook_filter` | String(8) | `"true"`\|`"false"` — show notebook dropdown to all visitors on published list |
| `scan_prompt` | Text | Custom scan prompt; when non-empty, replaces `SCAN_PROMPT_BASE` in `app/main.py` for that user's scans (`SCAN_PROMPT_JSON_SHAPE` is always appended regardless). Only editable by `opti66@gmail.com` via the Advanced card in Settings (which also shows the read-only default prompt fetched from `GET /api/default-scan-prompt`). |

**`notebooks` table** (created via `create_all`, no migration needed):
| Column | Type | Purpose |
|---|---|---|
| `id` | String(36) PK | UUID |
| `user_id` | String(255) | Clerk user sub (indexed) |
| `title` | String(512) | Notebook name |
| `slug` | String(255) | URL slug; auto-generated on create; editable via `PUT /api/notebooks/{id}`; used in `?nb={slug}` published list URLs |
| `created_at` | DateTime | UTC creation time |

**`note_notebooks` table** — many-to-many join (created via `create_all`, no migration needed):
| Column | Type | Purpose |
|---|---|---|
| `note_id` | String(36) PK | References `notes.id` |
| `notebook_id` | String(36) PK | References `notebooks.id` |

Composite primary key prevents duplicates. Notes not in any notebook simply have no rows here — `get_note_notebook_ids()` returns `[]` for them. Existing notes created before the feature are automatically treated as belonging to no notebooks, with no migration needed.

Key functions: `get_settings(user_id)`, `upsert_settings(user_id, fields)`, `get_settings_by_list_token(token)`, `list_published_notes(user_id)` — returns notes with `notebook_ids` per note (batch query), ordered by `scanned_at desc`. `update_note_files(user_id, note_id, files)`, `get_adjacent_published_notes(user_id, note_id)` — returns `{prev_token, next_token}` for prev/next navigation on share pages. `list_published_notebooks(user_id)` — notebooks that contain at least one published note; returns `{id, title, slug}` (used by published list API to populate the filter dropdown).

Notebook functions: `list_notebooks(user_id)` — returns user notebooks (LEFT JOIN `note_notebooks`) followed by four virtual system notebooks (`_SYSTEM_NOTEBOOKS` constant) with live note counts; each entry has `is_system: bool` and `slug` (user notebooks only). `list_notes()` handles `system:public`, `system:login_restricted`, `system:me`, `system:unpublished` as special `notebook_id` values. `set_note_notebooks()` strips system IDs before writing. `create_notebook(user_id, title)` — creates notebook with `slug=NULL` (no public URL by default); `update_notebook(user_id, notebook_id, title, slug=None)` — `slug=None` auto-derives from title; `slug=""` clears to NULL (disables public URL); `slug=str` slugifies + deduplicates; `delete_notebook(user_id, notebook_id)` — removes join rows then notebook; `get_note_notebook_ids(note_id)` — returns list of notebook IDs. `get_notebook_by_slug(user_id, slug)` — looks up a user's notebook by slug.

**`notes` table notable columns** (besides the obvious text/JSON fields):
| Column | Type | Notes |
|---|---|---|
| `share_token` | String(36) | UUID; set by `publish_note()`; cleared by `unpublish_note()` |
| `is_published` | Boolean | True when share_token is active |
| `visibility` | String(32) | `public` \| `logged_in` \| `me` — access control on the share page |
| `publish_options` | JSON | Per-note publish settings (see Publish/Share section) |
| `slug` | String(255) | Human-readable URL slug; auto-generated from title on first publish; editable in publish panel |

---

## Markdown Rendering

`app.js` functions (defined just before the router):

- `escapeHtml(s)` — XSS-safe HTML entity escaping
- `renderMarkdown(text)` — converts `## h2`, `### h3`, `- `/ `* ` lists, `1. ` ordered lists, `**bold**` to HTML; bare `http`/`https` URLs become `<a>` links (via `inlineFormat`); all other content becomes `<p>` wrapped. No external library.
- `setMd(el, text)` — sets `el.innerHTML = renderMarkdown(text)` and stores `el.dataset.rawMd = text`

**Edit mode uses EasyMDE** (loaded from CDN in `results.html`): clicking Edit on Summary/Transcription/Additional Notes opens an EasyMDE instance (toolbar + preview toggle) instead of a plain textarea. Active instances are tracked in the `editors` Map keyed by section name. `getText(section)` queries the live EasyMDE instance if one exists, falling back to `el.dataset.rawMd ?? el.textContent`. Done destroys the EasyMDE instance and re-renders with `setMd()`. Note-title keeps a plain `<input>` (no EasyMDE).

---

## Icon vocabulary (do not deviate)

| Icon | Meaning | Used on |
|---|---|---|
| Globe (circle + lat/lon lines) | Link to published notes list | Home, notes.html, share.html, published.html header buttons |
| Unlock / open padlock | Public visibility status | Visibility filter bars, visibility badges on cards |
| Person silhouette | Members-only (`logged_in`) visibility | Same filter/badge contexts |
| Eye | Private (`me`) visibility | Same filter/badge contexts |
| Folder | My Notes navigation link | All pages with header-right |
| House | Home navigation | share.html, published.html corner cluster |
| Pencil on page | Edit note | Owner-only on share page |
| Book / notebook | Notebooks navigation link | All app pages with header-right (`index.html`, `results.html`, `notes.html`, `settings.html`, `notebooks.html` header); also in owner nav on `published.html` |
| Question-mark circle | Help | Hamburger menu item on all app pages |
| Chain-link | Enable / disable notebook public URL | Notebook card action button on `notebooks.html`; grey = no URL, accent = active |

---

## Making Changes

- **Claude prompt / model**: edit `SCAN_PROMPT_BASE` / `MODEL` constant in `app/main.py`. `SCAN_PROMPT_JSON_SHAPE` is always appended and must not be removed — it keeps Claude's output parseable. Users with a non-empty `scan_prompt` in their `user_settings` row override `SCAN_PROMPT_BASE` for their own scans; the Advanced card in `settings.html` exposes this editor for `opti66@gmail.com` only (gated in `initSettings()` by `window.Clerk.user.primaryEmailAddress.emailAddress`). The default prompt is exposed via `GET /api/default-scan-prompt` (auth'd) so the settings page can display it read-only.
- **EXIF fields extracted**: edit `_extract_exif()` in `app/main.py`
- **Styling**: CSS variables at top of `style.css`
- **Markdown rendering**: edit `renderMarkdown()` in `app.js`
- **Landing page**: edit `landing.html` directly — it is self-contained (inline CSS, no app.js/style.css dependency). Served at `/landing` and `/landing.html` by the static file mount with no explicit route needed.
- **Share checkboxes** (title/date/images/summary/transcription/additional notes): `#share-card` in `results.html`; the `#share-btn` handler in `app.js` assembles checked sections and calls `share()`; additional notes only added to output when non-empty
- **Publish options** (per-note): `#publish-card` in `results.html`; `getPublishOptions()`/`restorePublishOptions()` in `app.js`; stored in `notes.publish_options` JSON column. `savePublishOptions()` sends both text fields and publish_options together so title/summary edits are never lost when using publish actions.
- **Image exclude/delete per tile**: `addImageTile()` in `app.js` — Exclude button toggles `excludedImages` Set; Delete button calls `DELETE /api/notes/{id}/files/{position}` (saved mode only)
- **Add images to saved note**: `enableAddImages(noteId)` in `app.js` — call after save or on saved-mode load; uses `dataset.wired` guard to prevent double-wiring
- **Global settings** (template/logo/list title): `settings.html` + `initSettings()` in `app.js`; stored in `user_settings` table via `PUT /api/settings`
- **Share button on share page**: `#sp-share-btn` in `share.html`; always shown (not owner-gated); wired in `initShare()` after data loads; uses `navigator.share` with clipboard fallback
- **URL slug for published notes**: editable `#pub-slug` input in `results.html` publish panel; `savePublishOptions()` sends `slug` in PUT body; auto-filled from title client-side via `slugify()`; server deduplicates with `_make_slug()`; `restorePublishOptions()` populates from `data.slug`
- **OG meta tags on share page**: `share_page_route` in `app/main.py`; builds meta block from DB data; use proxy headers (`x-forwarded-proto`, `x-forwarded-host`) for correct public origin; all user content HTML-escaped via `_html.escape()`
- **Owner-only share page UI** (visibility icon + edit button): `showEditBtn()` in `app.js`; called when `data.is_owner` is true; icons defined inline in the function; container is `.sp-corner-btns` in `share.html`
- **Published list owner features** (visibility icons on cards, filter bar): `initPublished()` in `app.js`; filter bar is `#pub-vis-filter` in `published.html` (hidden until owner confirmed); `renderNotes()` adds `.pub-card-vis` badge when `settings.isOwner`
- **My Notes visibility filter**: `#notes-vis-filter` in `notes.html`; `initNotes()` in `app.js` uses client-side filtering (`filteredNotes()`) — notes loaded once, filtered in memory by `activeVis` + search query. Filter works on `n.visibility` field; non-published notes hidden when a visibility filter is active.
- **My Notes notebook filter**: `#notes-notebook-filter` select in `notes.html` (below the search bar); `initNotes()` populates it from `GET /api/notebooks` on load; change triggers `loadAll()` which passes `?notebook_id=` to the server — notes are server-filtered by notebook, then client-filtered by search + visibility. Pre-selects from `?notebook` URL param so notebook links from `notebooks.html` work.
- **Notebooks management page**: `notebooks.html` + `initNotebooks()` in `app.js`; lists user notebooks then system notebooks; inline rename/delete/add-notes panel for user notebooks only; search (`#nb-search`) and sort (`#nb-sort`: `alpha`|`date`) controls above the list; `filteredNotebooks()` applies sort+search client-side, always placing system notebooks at the end; clicking a notebook navigates to `notes.html?notebook=<id>`.
- **System notebooks**: four read-only virtual notebooks (Public, Login restricted, Only me, Unpublished) appended by `list_notebooks()`. Identified by `id.startsWith('system:')` or `is_system: true`. No edit/delete/add-notes UI rendered for them. `loadNotebooksCard` on results page filters them out (`userNotebooks = notebooks.filter(nb => !nb.is_system)`). Cannot be assigned manually — backend strips them in `set_note_notebooks()`.
- **Notebooks card on results page**: `#notebooks-card` in `results.html` (hidden until note is saved); `loadNotebooksCard(noteId, initialNotebookIds)` in `app.js` — fetches notebook list, renders checkboxes, each toggle immediately calls `PUT /api/notes/{noteId}/notebooks`. Called in saved mode with `data.notebook_ids` from `GET /api/notes/{id}`; called with `[]` immediately after a fresh save. Existing notes have `notebook_ids: []` by default (no migration needed).
- **Help page**: `help.html` served at `/help`; `initHelp()` in `app.js` loads Clerk, shows `#site-nav`, calls `initHamburger()` — no auth wall (page is informational). Hamburger on the help page links to Help (self), Settings, Sign out. Header-right: Notebooks, My Notes, Home.
- **Hamburger menu**: Contains Help → Settings → Sign out on all app pages. Help link uses question-mark circle icon.
- **HTML caching fix**: FastAPI middleware `no_cache_html` in `app/main.py` sets `Cache-Control: no-cache` on all `text/html` responses, preventing stale pages on mobile PWA installs where there is no visible browser refresh.
- **Publish visibility default**: `<option value="me" selected>` in `#pub-visibility` select in `results.html`. Change the `selected` attribute to change the default.
- **Scan prompt for visual images**: `SCAN_PROMPT_BASE` in `app/main.py` — edit the "If primarily VISUAL" branch to change how non-text images are described.
- **DB schema changes on `notes`**: add column to `notes` Table in `app/db.py` AND add an `ALTER TABLE` guard in `_migrate_schema()`. New tables: just add to `metadata` — `create_all()` handles them automatically.
- **Tests**: add blocks inside `runTests()` in `test.html`
- **PWA icons**: replace `icons/icon-192.png` and `icons/icon-512.png` with real branded art (192×192 and 512×512 PNG). Colors in `manifest.json` (`background_color`, `theme_color`) and the `<meta name="theme-color">` in all six HTML files should match the `--bg` and `--accent` CSS variables in `style.css`.
- **Scan file limit**: `MAX_FILES = 10` constant in `addFiles()` in `app.js` (inside `initIndex()`); enforced server-side in `scan_notes()` in `app/main.py` with a 400 error. Change both values in sync.
- **Pre-scan thumbnails**: `renderThumbs()` in `app.js` builds `#pre-scan-thumbs` (`index.html`) using `URL.createObjectURL()` for instant previews; revoked in `img.onload`. `.pre-scan-*` styles in `style.css`. × remove button filters `selectedFiles` by reference identity.
- **Infinite scroll / progressive rendering**: `appendNoteCards(items, fromIdx)` in `initNotes()`, `appendPubCards(items, fromIdx)` in `initPublished()`, `appendNbCards(items, fromIdx)` in `initNotebooks()` — all use the same IntersectionObserver sentinel pattern (PAGE = 20, rootMargin 300px). `.load-sentinel` style in `style.css`. Data is loaded in one fetch; only rendering is batched.
- **Notebook filter on published list**: `#pub-notebook-filter` select in `published.html`; populated in `initPublished()` via `list_published_notebooks()` in `app/db.py`; visible only to list owner; controlled by `show_notebook_filter` in `user_settings` (toggle in `settings.html`). Filter sends `?notebook_id=` to `GET /api/published/{list_token}`.
- **Notebook URL slugs**: `slug` column on `notebooks` table (added via `_migrate_schema`). Notebooks start with `slug=NULL` (no public URL). `PUT /api/notebooks/{id}` accepts optional `slug` in payload; `slug=""` clears to NULL. `GET /api/published/{identifier}` tries UUID list_token first, then tries global notebook slug via `get_notebook_by_global_slug(slug)` in `app/db.py`; when resolved via slug, notes are server-filtered to that notebook. Friendly URLs: `/published/coffee` resolves directly (no UUID in path). `initPublished()` passes the path segment as-is to the API; uses `data.activeNotebook.title` as page header when present; dropdown change navigates to `/published/{slug}` via `history.replaceState`. Notebook cards on `/notebooks` have a chain-link toggle button (grey = no URL, accent = active); clicking grey enables (sends `PUT` with title only → auto-slug); clicking active disables with confirm (sends `slug: ""`). URL row (shown when slug set) has `/published/{slug}` link, inline editable slug input (auto-saves 800ms debounce), and copy button. `window._pubListToken` set from `/api/settings` at page load; URL row hidden if absent.
- **Notes assignment panel on Notebooks page**: `toggleNotesPanel(nb, card)` inside `initNotebooks()` in `app.js` — clicking the ✓ icon on a notebook card opens an inline panel below the card showing all user notes with checkboxes; checking/unchecking calls `PUT /api/notes/{id}/notebooks` for that note.

---

## Multi-Utility Platform

Auth is live. For future utilities: each gets its own repo + Railway service, sharing the same Clerk app (same `CLERK_PUBLISHABLE_KEY` / `CLERK_JWKS_URL`). Copy `app/auth/verify.py` into each service. The `AUTH_HANDOFF.md` in this repo has the full pattern.
