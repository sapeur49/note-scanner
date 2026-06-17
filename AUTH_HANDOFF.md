# Auth Hub — Handoff Document

This document captures the agreed architecture for adding user authentication across ReadWrite and future utility tools. Take this to a new conversation/repo to implement.

---

## The Goal

Protect one or more web utilities (starting with ReadWrite) behind a shared login wall using [Clerk](https://clerk.com). Users sign in once and can access any tool that's been added to the hub.

---

## Architecture Decision: Option A — Separate Repos, Shared Clerk App

Each utility lives in its **own Railway service and repo**. They all reference the same Clerk application (same `CLERK_PUBLISHABLE_KEY` / `CLERK_JWKS_URL`). A central hub page links out to all tools.

**Why this way:**
- Independent deploys and failure domains
- Adding a new tool doesn't touch existing ones
- Each service verifies JWTs itself — no central auth service to maintain
- Scales cleanly to Stripe billing later (second FastAPI dependency alongside auth)

---

## Three Layers

| Layer | What it does | Where it lives |
|---|---|---|
| **Clerk** | Identity — sign-up, sign-in, session JWTs | Clerk dashboard (one app shared across tools) |
| **FastAPI middleware** | Verifies JWT on every protected request | `app/verify.py` in each service repo |
| **Each service** | Declares auth as a FastAPI dependency | `app/main.py` in each service repo |

---

## Repo Structure

```
readwrite/            ← this repo (already exists)
  app/
    main.py           ← add auth dependency here
    verify.py         ← NEW: JWT verification helper
  index.html          ← wrap upload UI behind Clerk <SignedIn>
  ...

auth-hub/             ← NEW repo (optional — just a static hub page)
  index.html          ← links to ReadWrite, future tools
  style.css
```

The `auth-hub` repo can be a simple static page deployed to Railway or GitHub Pages — it just needs the Clerk JS SDK to show a login button and route signed-in users to the right tool.

---

## Reusable `verify.py` (copy into each service)

```python
# app/verify.py
import os
import httpx
from jose import jwt, JWTError
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

JWKS_URL = os.environ["CLERK_JWKS_URL"]  # e.g. https://<your-clerk-domain>/.well-known/jwks.json
_jwks_cache = None

async def _get_jwks():
    global _jwks_cache
    if not _jwks_cache:
        async with httpx.AsyncClient() as c:
            _jwks_cache = (await c.get(JWKS_URL)).json()
    return _jwks_cache

bearer = HTTPBearer()

async def require_auth(creds: HTTPAuthorizationCredentials = Security(bearer)):
    token = creds.credentials
    try:
        jwks = await _get_jwks()
        jwt.decode(token, jwks, algorithms=["RS256"], options={"verify_aud": False})
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

Add to `requirements.txt`:
```
python-jose[cryptography]
httpx
```

---

## Wiring Auth into a Service (15-min recipe)

### 1. Backend (`app/main.py`)

```python
from app.verify import require_auth
from fastapi import Depends

@app.post("/api/scan")
async def scan_notes(
    files: List[UploadFile] = File(...),
    instructions: str = Form(default=""),
    _user=Depends(require_auth),   # ← add this line
):
    ...
```

### 2. Frontend (`index.html` / any protected page)

```html
<!-- In <head> -->
<script async crossorigin="anonymous"
  src="https://YOUR_CLERK_DOMAIN/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
  data-clerk-publishable-key="pk_live_...">
</script>

<script>
window.addEventListener("load", async () => {
  await window.Clerk.load();
  if (!Clerk.user) {
    document.getElementById('app').hidden = true;
    await Clerk.openSignIn();
  }
});
</script>
```

**Important**: The Clerk JS script src must come from your Clerk domain (e.g. `https://glad-clam-42.clerk.accounts.dev/npm/@clerk/clerk-js@5/dist/clerk.browser.js`), not from a CDN like jsdelivr. Using the official Clerk domain is required for Google OAuth and other social providers to appear.

### 3. Send JWT with each scan request (`app.js`)

```js
// Ensure Clerk is initialized before allowing scan
async function waitForClerk() {
  return new Promise(resolve => {
    if (window.Clerk?.loaded) return resolve();
    document.addEventListener('clerk:loaded', resolve);
    setTimeout(resolve, 3000); // fallback
  });
}

// In scan handler:
await waitForClerk();
const session = window.Clerk?.session;
const token = session ? await session.getToken() : null;
if (!token) { showError('Please sign in to scan.'); return; }

const response = await fetch(SCAN_URL, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData,
});
```

### 4. Railway env vars (add to each service)

| Var | Value |
|---|---|
| `CLERK_JWKS_URL` | `https://<your-clerk-domain>/.well-known/jwks.json` |

The Clerk publishable key goes in the HTML (it's public — safe to commit).

---

## Common Bugs

**Google OAuth not appearing in sign-in modal**
- Cause: Clerk JS loaded from a third-party CDN (e.g. jsdelivr) instead of your Clerk domain
- Fix: Use `https://<your-clerk-domain>/npm/@clerk/clerk-js@5/dist/clerk.browser.js` as the script src

**"Missing or invalid Authorization header" from backend**
- Cause: `getToken()` returning null, or Clerk not yet initialized when scan is triggered
- Fix: Check `window.Clerk.session` is non-null before calling `getToken()`, and await a `waitForClerk()` helper before the scan handler runs
- Debug: `console.log('token:', await window.Clerk?.session?.getToken())` before the fetch

---

## First Milestones

1. **Create Clerk app** at clerk.com — note the publishable key and JWKS URL
2. **Create `auth-hub` repo** — static page with Clerk sign-in and links to tools
3. **Add auth to ReadWrite** — `verify.py` + `Depends(require_auth)` on `/api/scan` + Clerk JS in `index.html`
4. **Test end-to-end** — sign in, scan, confirm 401 without token
5. **Add second tool** — copy `verify.py`, same Clerk app, done

---

## ReadWrite Context (current state)

- Repo: `sapeur49/note-scanner` (may be renamed to `readwrite`)
- Railway service: personal account, auto-deploys from `main`
- `SCAN_URL = '/api/scan'` — relative, same origin
- No auth today — anyone with the Railway URL can scan
- `app/main.py` is the only backend file; `verify.py` doesn't exist yet
- Frontend is plain HTML/JS — no bundler, no framework

---

## Effort Estimate

| Task | Time |
|---|---|
| Clerk app setup + JWKS URL | 15 min |
| `verify.py` + backend wiring | 30 min |
| Frontend Clerk JS + token on fetch | 45 min |
| Auth hub static page | 30 min |
| Testing + Railway env vars | 15 min |
| **Total** | **~2.5 hours** |
