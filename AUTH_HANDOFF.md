# Auth Hub — Handoff Document

## What This Is

A plan for adding Clerk-based user authentication to ReadWrite and future utilities. This document is self-contained — use it to start a new conversation or repo for the auth implementation.

---

## Architecture Decision: Option A

**One Clerk app, one repo per utility, no central auth service.**

Each utility (ReadWrite, and future tools) is its own Railway service and GitHub repo. They all share the **same Clerk application** (same `CLERK_PUBLISHABLE_KEY` / JWKS URL), so a single user account works across all tools.

There is no central "auth gateway" service. Each FastAPI service verifies JWTs independently using a shared ~15-line `verify.py` module.

### Why Option A

- Independent deploys — a bug in one tool doesn't affect others
- No single point of failure
- Adding a new tool is a 15-minute copy-paste job
- If you later want per-tool entitlements (e.g. "user has ReadWrite but not Tool B"), add a `subscriptions` check inside each tool's dependency — no cross-service coordination needed

---

## Three Layers

| Layer | What it does | Where it lives |
|---|---|---|
| **Clerk** | Identity — sign-up, sign-in, session tokens | clerk.com (hosted) |
| **FastAPI dependency** | JWT verification — validates the Clerk session token on each request | `app/verify.py` in each service repo |
| **Each service** | Applies the dependency to protected routes | `app/main.py` in each service repo |

---

## Repo Structure

### `readwrite` (this repo — existing)

Add:
```
app/
  verify.py      ← shared JWT verification helper
```

Modify:
```
app/main.py      ← add `Depends(require_auth)` to /api/scan
index.html       ← add Clerk JS SDK, wrap UI in <SignedIn>/<SignedOut>
```

### Future tool repos

Copy `app/verify.py` verbatim. Add Clerk JS to the frontend. Done.

### Optional: `auth-hub` repo (hub page)

A static page listing all tools with links — no auth logic needed here, each tool handles its own. Could be a GitHub Pages site or another Railway service.

---

## `verify.py` — Reusable JWT Verification

```python
import os
import httpx
import jwt  # PyJWT

JWKS_URL = os.environ["CLERK_JWKS_URL"]
# e.g. https://<your-clerk-domain>/.well-known/jwks.json

_jwks_client = jwt.PyJWKClient(JWKS_URL)

def verify_clerk_token(token: str) -> dict:
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},
    )
```

Usage in `main.py`:

```python
from fastapi import Depends, Header, HTTPException
from app.verify import verify_clerk_token

def require_auth(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return verify_clerk_token(authorization[7:])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/scan")
async def scan_notes(
    files: List[UploadFile] = File(...),
    instructions: str = Form(default=""),
    _user = Depends(require_auth),   # ← add this
):
    ...
```

---

## Frontend: Clerk JS (CDN, no bundler needed)

```html
<!-- In <head> -->
<script
  async
  crossorigin="anonymous"
  data-clerk-publishable-key="pk_live_..."
  src="https://YOURFRONTENDAPI.clerk.accounts.dev/npm/@clerk/clerk-js@latest/dist/clerk.browser.js"
  type="text/javascript"
></script>

<script>
window.addEventListener('load', async () => {
  await window.Clerk.load();

  if (window.Clerk.user) {
    // User is signed in — show the app
    document.getElementById('app').hidden = false;
  } else {
    // Not signed in — show sign-in UI
    window.Clerk.mountSignIn(document.getElementById('sign-in'));
  }
});
</script>
```

Sending the token on API calls:

```js
const token = await window.Clerk.session.getToken();
const response = await fetch('/api/scan', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData,
});
```

---

## 15-Minute Recipe: Wire Auth into a New Tool

1. Copy `app/verify.py` into the new repo
2. Add `PyJWT` and `httpx` to `requirements.txt`
3. Add `CLERK_JWKS_URL` to Railway env vars (same value for every tool)
4. Add `Depends(require_auth)` to protected endpoints in `main.py`
5. Add Clerk JS CDN snippet to frontend HTML
6. Replace direct `fetch('/api/...')` calls with token-bearing version above

---

## Railway Environment Variables (per service)

| Var | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `CLERK_JWKS_URL` | `https://<your-clerk-domain>/.well-known/jwks.json` — from Clerk dashboard |

No `CLERK_SECRET_KEY` needed — JWT verification uses only public keys via JWKS.

---

## First Milestones

1. **Create Clerk app** at clerk.com — note the publishable key and JWKS URL
2. **Add `verify.py`** to ReadWrite repo
3. **Add Clerk JS** to `index.html` and `results.html` — gate the UI behind sign-in
4. **Add `Depends(require_auth)`** to `/api/scan` in `main.py`
5. **Set `CLERK_JWKS_URL`** in Railway env vars
6. **Test**: sign in → scan notes → results appear; sign out → redirected to sign-in

---

## ReadWrite Context

- Repo: `sapeur49/note-scanner` (private, Railway personal account)
- Live at: check Railway dashboard for current URL
- Current state: fully working — scan images/PDFs, summary + transcription + optional additional notes
- No auth today — anyone with the URL can scan
- `ANTHROPIC_API_KEY` already set in Railway env vars
- Backend: `app/main.py` (FastAPI) — single endpoint `POST /api/scan`
- Frontend: `index.html`, `results.html`, `app.js` (version 10)

---

## Effort Estimate

| Task | Time |
|---|---|
| Create Clerk app + get keys | 10 min |
| Add `verify.py` + backend wiring | 30 min |
| Add Clerk JS to frontend (ReadWrite) | 45 min |
| Test end-to-end on Railway | 15 min |
| **Total** | **~1.5 hours** |
