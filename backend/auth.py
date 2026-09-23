"""
Authentication: password hashing (bcrypt via passlib) and JWTs (python-jose).

Two different hashing needs show up in this app, deliberately handled differently:
  - passwords, here, use bcrypt — slow on purpose, so brute-forcing a stolen hash is
    expensive even offline.
  - handoff OTP codes (see routes/handoffs.py) use plain SHA-256 instead — a 6-digit code
    already has only 10^6 possibilities, has a 10-minute expiry, and is guarded by an
    attempt cap, so bcrypt's deliberate slowness would only cost latency without adding
    real protection. Using the same slow hash for both would be a case of applying a tool
    without asking whether it actually fits the problem.
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days — a student project doesn't need refresh-token infrastructure; see README

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# auto_error=False + our own check below: FastAPI's HTTPBearer default returns 403 when no
# Authorization header is present at all, which conflates "not authenticated" with "not
# authorized" — this keeps the convention clean and explainable: 401 for any authentication
# problem (missing OR invalid token), 403 reserved for ownership/authorization failures
# elsewhere in the app (see routes/trips.py etc. for those).
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str:
    """Returns the user id encoded in the token, or raises 401 if it's missing/invalid/expired."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        return user_id
    except JWTError:
        raise credentials_exception


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """The single source of truth for "who is making this request" — every ownership check
    in the app (Section 6: "never trust a user ID supplied by the frontend") compares
    against current_user.id from here, never anything read out of a request body."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = decode_access_token(credentials.credentials)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
