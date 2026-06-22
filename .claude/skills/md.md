# Update Markdown Docs

Update `CLAUDE.md` and `HANDOVER.md` to reflect changes in the repo that aren't yet documented.

## Steps

1. **Find what changed since the docs were last updated:**
   ```bash
   git log --oneline --since="$(git log --follow -1 --format='%ci' CLAUDE.md)" -- . ':(exclude)CLAUDE.md' ':(exclude)HANDOVER.md'
   ```
   Also run `git log --oneline -20` to see recent commits for context.

2. **Read current state of both docs:**
   Read `CLAUDE.md` and `HANDOVER.md` in full so you know what's already documented.

3. **Read the key source files** to understand what actually changed:
   - `app/main.py` — prompt constants, MODEL, tools param, new routes, new functions
   - `app/db.py` — schema, new tables/columns, new functions
   - `app/js` / `style.css` if frontend changes are relevant
   - Any new `.html` files

4. **Identify gaps** — features or changes present in code but absent (or outdated) in the docs.

5. **Update `HANDOVER.md`:**
   - Add new rows to the features table at the **top** (newest first). Match existing row format exactly: `| Feature name | ✅ Shipped | Brief description |`
   - Update the "Open items / Railway config" section if anything is resolved or newly pending.
   - Update the end-to-end checklist if new flows need testing.

6. **Update `CLAUDE.md`:**
   - Update the **Backend** architecture section for new routes, constants, or prompt changes.
   - Update the **Making Changes** section with new entries for any new knobs or patterns.
   - Update the **Database** section for new tables/columns/functions.
   - Update the **Architecture** file tree if new files were added.
   - Do NOT rewrite sections that haven't changed — surgical edits only.

7. **Commit and push** the doc updates on the current branch:
   ```bash
   git add CLAUDE.md HANDOVER.md
   git commit -m "docs: update CLAUDE.md and HANDOVER.md to reflect recent changes"
   git push -u origin HEAD
   ```

## Output

Tell the user:
- What features/changes were found undocumented
- Which sections of each file were updated
- Confirm commit and push succeeded
