import os
import jwt
from jwt import PyJWKClient

JWKS_URL = os.environ.get("CLERK_JWKS_URL", "")
ISSUER   = os.environ.get("CLERK_ISSUER", "")

_jwks_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not JWKS_URL:
            raise RuntimeError("CLERK_JWKS_URL not set")
        _jwks_client = PyJWKClient(JWKS_URL)
    return _jwks_client


def verify_clerk_token(token: str) -> dict:
    signing_key = _client().get_signing_key_from_jwt(token)
    kwargs = dict(
        algorithms=["RS256"],
        options={"verify_aud": False},
    )
    if ISSUER:
        kwargs["issuer"] = ISSUER
    return jwt.decode(token, signing_key.key, **kwargs)
