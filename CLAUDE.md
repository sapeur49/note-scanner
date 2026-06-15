# ReadWrite — Developer Guide

## What This Is

**ReadWrite** is a zero-dependency static web app that scans photos of handwritten or printed notes using Claude's vision API. No backend, no build step, no npm. It's a folder of HTML/CSS/JS files deployed to GitHub Pages.

## Local Development

```bash
# Any static server works. Python is usually available:
python3 -m http.server 8080
# Open http://localhost:8080
```

Note: the Web Share API requires HTTPS. On localhost, the share button will fall back to clipboard copy. Test native sharing via the deployed GitHub Pages URL.

## File Responsibilities

| File | Purpose |
|---|---|
| `index.html` | Upload UI — API key, image input, scan button |
| `results.html` | Results display — summary, transcription, share buttons |
| `app.js` | All JS logic — shared between both pages, routed by DOM detection |
| `style.css` | Shared styles, CSS variables for light/dark mode |
| `test.html` | Self-contained QA harness — runs in browser, no API key needed |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages on push to main |

## API Key

- Stored in `localStorage` under key `rw_api_key`
- User enters it once in the UI; it persists across sessions
- Never committed to the repo

## Claude API Details

- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Model**: `claude-sonnet-4-6`
- **Required headers**:
  - `x-api-key: <user key>`
  - `anthropic-version: 2023-06-01`
  - `anthropic-dangerous-direct-browser-calls: true` ← required for browser fetch
- **Payload**: all images as base64 `image` content blocks + a text instruction block in one message
- **Response format**: Claude returns JSON `{ "summary": "...", "transcription": "..." }`; code strips markdown fences before parsing

## Data Flow

```
index.html
  → user selects images
  → app.js converts to base64 via FileReader
  → single fetch() to Claude API with all images
  → JSON response parsed
  → stored in sessionStorage as rw_results
  → redirect to results.html

results.html
  → reads rw_results from sessionStorage
  → renders summary + transcription
  → share buttons call navigator.share() or clipboard fallback
```

## QA / Review Workflow

After any change, check the test harness:

1. Open `http://localhost:8080/test.html` (or the deployed GitHub Pages URL)
2. Tests run automatically on page load
3. All items should show **PASS** — look for any **FAIL** badges
4. Claude Code can fetch the deployed URL and scan for `FAIL` text to automate this check

Deployed test page: `https://sapeur49.github.io/note-scanner/test.html`

## Deployment

Push to `main` → GitHub Actions automatically deploys to GitHub Pages.

Live URL: `https://sapeur49.github.io/note-scanner/`

To enable GitHub Pages on a fresh repo:
1. Go to repo Settings → Pages
2. Set source to **GitHub Actions**
3. The workflow in `.github/workflows/pages.yml` handles the rest

## Making Changes

- **Styling**: edit CSS variables at the top of `style.css` for color/spacing changes
- **Claude prompt**: update `SCAN_PROMPT` in `app.js` — the JSON shape must match what `initResults()` expects
- **Adding a new share format**: add a button in `results.html` with a `data-target` attribute and handle it in the `share()` event listener in `app.js`
- **Tests**: add new test blocks inside `runTests()` in `test.html`
