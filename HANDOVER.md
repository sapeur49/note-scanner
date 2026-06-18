# HANDOVER — Saved Notes deployment (continuity snapshot)

Live state for picking up the **saved-notes feature** in a fresh thread. Durable project
docs live in `CLAUDE.md`; this file is the "where we are right now" snapshot.
**Date of this snapshot:** 2026-06-18.

## Where we are
- Working branch: **`claude/beautiful-cerf-86quxm`** (HEAD = `791a217`). **Not merged to
  `main`.** Railway is deploying **this branch** (user pointed the service Source at it to
  test before merging).
- The saved-notes feature (MySQL persistence + Railway volume + Save/My Notes/edit/delete)
  is **code-complete**. We are in the **deploy-and-debug** phase against real Railway infra.

## What's been done this session (newest first)
1. `791a217` — **Auth fix**: fresh (post-scan) `results.html` never loaded Clerk, so
   `getToken()` returned null and **Save** POSTed with no `Authorization` header → 401
   "Missing or invalid Authorization header". Fresh mode now `await waitForClerk();
   await window.Clerk.load();` before render (matches saved mode). Cache-buster → `?v=16`.
2. `beb2e4b` — **Crash fix**: a bare `DATABASE_URL` (e.g. a DB *name* like `railway`
   instead of a URL) made module-level `create_engine()` throw at import, crashing the
   whole app before `main.py`'s try/except could catch it. `_db_url()` now detects a
   missing `://`, logs a clear warning, and falls back to SQLite so the app still boots.
3. `8f30631` — Compacted `CLAUDE.md`, added Current State block.

## Open items (user actions on Railway — NOT code)
1. **Set `DATABASE_URL` to a real connection string.** Must be a full
   `mysql://user:pass@host:port/db` — reference the MySQL service's `MYSQL_URL` (or its
   `DATABASE_URL`) via `${{MySQL.MYSQL_URL}}`. **NOT** `MYSQL_DATABASE` (just the DB name)
   and **NOT** the individual `MYSQLHOST`/`MYSQLPORT` parts. App also accepts `MYSQL_URL`.
   - Symptom if still wrong: app boots but logs `[db] ... Falling back to SQLite — saved
     notes will NOT persist`, and notes vanish on the next redeploy.
2. **Volume**: confirm a Railway Volume is mounted at `/data` and `VOLUME_PATH=/data` is
   set. Saved files land at `<VOLUME_PATH>/notes/<note_id>/`.
3. **Redeploy** so Railway builds the latest branch commit (verify the deployed SHA matches
   `791a217` or newer — an old deploy will still show fixed bugs).

## How to verify (end-to-end, on the deployed branch)
1. Watch deploy logs: **no** `[db] ... Falling back to SQLite` warning → MySQL wired OK.
2. Sign in → scan an image (and a PDF) → on results page click **Save** → expect "Saved ✓"
   (no 401).
3. **My Notes** (`notes.html`) → the note appears with title/date/snippet; search by a word
   from the transcription matches.
4. Open the note (`results.html?id=…`) → images render (auth'd blob fetch), text matches.
   Edit summary → **Update** → reload → change persisted.
5. **Delete** → row gone, volume folder removed, list no longer shows it.

## Merge to main (when verified)
Env vars live on the **service**, not the branch, so they persist when you switch Source
back to `main`. Then:
```bash
git push origin claude/beautiful-cerf-86quxm:main   # or open a PR
```
Railway auto-deploys `main` via `Procfile`. After merge, update `CLAUDE.md` Current State
to say the feature is live, and this HANDOVER.md can be deleted.

## Gotchas worth remembering
- The crash traceback referenced `app/db.py` line 40 = `create_engine(...)` — that was the
  **pre-`beb2e4b`** layout. If you see that exact line, Railway is running an old commit.
- `app/db.py` only exists on this branch, not `main`. A thread reading `main` will wrongly
  conclude the file is "untracked" — always work from the branch (per `CLAUDE.md`).
- `ANTHROPIC_API_KEY` stays server-side only; never sent to the browser.
- Bump `?v=N` on `app.js`/`style.css` in index/results/notes.html for any JS/CSS change
  (currently `?v=16`).
