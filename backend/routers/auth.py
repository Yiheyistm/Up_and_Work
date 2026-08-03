"""
Auth Router.

Provides login-only authentication for the Up_and_Work dashboard.
There is no sign-up — credentials are defined once in .env:

  APP_EMAIL    = the email address used to log in
  APP_PASSWORD = the password used to log in
  APP_SECRET   = secret key used to sign JWT tokens (generate with: openssl rand -hex 32)

Endpoints:
  POST /api/v1/auth/login   — validate credentials, return JWT access token
  GET  /api/v1/auth/me      — validate a token and return the current user info

Token lifetime is controlled by APP_TOKEN_EXPIRE_HOURS (default 24).
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

router = APIRouter()
bearer_scheme = HTTPBearer(auto_error=False)

# ─── Config from env ──────────────────────────────────────────────────────────

APP_EMAIL   = os.getenv("APP_EMAIL", "")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
APP_SECRET  = os.getenv("APP_SECRET", "changeme-generate-with-openssl-rand-hex-32")
TOKEN_EXPIRE_HOURS = int(os.getenv("APP_TOKEN_EXPIRE_HOURS", "24"))

ALGORITHM = "HS256"


# ─── Schemas ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    """Credentials sent by the frontend login form."""
    email: str
    password: str


class TokenResponse(BaseModel):
    """Returned on successful login."""
    access_token: str
    token_type: str = "bearer"
    email: str


class MeResponse(BaseModel):
    """Returned by the /me endpoint."""
    email: str
    exp: datetime


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _create_token(email: str) -> str:
    """Sign a JWT containing the user's email and an expiry timestamp."""
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": email, "exp": expire}
    return jwt.encode(payload, APP_SECRET, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    """
    Decode and verify a JWT. Raises HTTPException 401 on any failure
    (invalid signature, expired, malformed).
    """
    try:
        return jwt.decode(token, APP_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired. Please log in again.")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """
    FastAPI dependency — extracts and validates the Bearer token from the
    Authorization header. Raises 401 if missing or invalid.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(credentials.credentials)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    """
    Validate email + password against APP_EMAIL / APP_PASSWORD in .env.
    Returns a signed JWT on success.

    No sign-up path exists — credentials are configured once by the operator.
    """
    if not APP_EMAIL or not APP_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="APP_EMAIL and APP_PASSWORD are not configured in .env. Cannot authenticate.",
        )

    # Case-insensitive email comparison, exact password match.
    if body.email.strip().lower() != APP_EMAIL.strip().lower() or body.password != APP_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    token = _create_token(APP_EMAIL)
    return TokenResponse(access_token=token, email=APP_EMAIL)


@router.get("/me", response_model=MeResponse)
async def me(current_user: dict = Depends(get_current_user)):
    """
    Verify the current token and return basic identity info.
    Used by the frontend on load to check if the stored token is still valid.
    """
    return MeResponse(
        email=current_user["sub"],
        exp=datetime.fromtimestamp(current_user["exp"], tz=timezone.utc),
    )
