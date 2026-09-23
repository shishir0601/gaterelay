import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Handoff, Trip, Request, HandoffStatus, TripStatus, RequestStatus, User, utcnow
from schemas import GenerateOTPOut, OTPVerify, HandoffOut
from auth import get_current_user

router = APIRouter()

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5


def _hash_code(code: str) -> str:
    # SHA-256, not bcrypt — see auth.py's module docstring for why a 6-digit, short-lived,
    # attempt-capped code doesn't need (and would only pay a latency cost for) a
    # deliberately slow password-grade hash.
    return hashlib.sha256(code.encode()).hexdigest()


def _get_handoff_or_404(db: Session, handoff_id: str) -> Handoff:
    # Eager-loads trip/request and their owners for the same reason as list_my_handoffs
    # above -- every handoff endpoint's response_model is HandoffOut, which nests full
    # TripOut/RequestOut (including owner_name), so this is the one shared place to fix it
    # rather than repeating the same N+1 risk in generate_otp/verify_otp/get_handoff too.
    handoff = (
        db.query(Handoff)
        .options(
            joinedload(Handoff.trip).joinedload(Trip.owner),
            joinedload(Handoff.request).joinedload(Request.owner),
        )
        .filter(Handoff.id == handoff_id)
        .first()
    )
    if handoff is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Handoff not found")
    return handoff


@router.get("", response_model=list[HandoffOut])
def list_my_handoffs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every handoff the caller is party to, as either traveler or requester — needed for
    the dashboard's "current handoffs" section. Not in the original endpoint sketch, but
    every other resource in this API has a list endpoint and the dashboard genuinely can't
    show in-progress handoffs without one, so this fills a real gap rather than adding
    scope for its own sake."""
    # A real N+1 found during review, worse than the one in matches.py: HandoffOut nests
    # full TripOut/RequestOut (including owner_name), and without eager loading each
    # returned handoff triggered its own separate trip/request/owner queries -- confirmed
    # empirically at 4 handoffs -> 15 total SQL statements. The .join()s below are for
    # filtering (the WHERE clause) and don't by themselves populate handoff.trip/.request
    # for later access; the .options(joinedload(...)) chains are what actually eager-load
    # those relationships (and their owners) in the same round trip.
    return (
        db.query(Handoff)
        .join(Trip, Trip.id == Handoff.trip_id)
        .join(Request, Request.id == Handoff.request_id)
        .options(
            joinedload(Handoff.trip).joinedload(Trip.owner),
            joinedload(Handoff.request).joinedload(Request.owner),
        )
        .filter((Trip.user_id == current_user.id) | (Request.user_id == current_user.id))
        .order_by(Handoff.created_at.desc())
        .all()
    )


@router.post("/{handoff_id}/generate-otp", response_model=GenerateOTPOut)
def generate_otp(handoff_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    handoff = _get_handoff_or_404(db, handoff_id)
    trip = db.query(Trip).filter(Trip.id == handoff.trip_id).first()
    if trip.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the traveler can generate a handoff code")
    if handoff.status != HandoffStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This handoff is already complete")

    code = f"{secrets.randbelow(1_000_000):06d}"
    handoff.otp_hash = _hash_code(code)
    handoff.otp_expires_at = utcnow() + timedelta(minutes=OTP_TTL_MINUTES)
    handoff.otp_attempts = 0  # generating a fresh code also resets the attempt count
    db.commit()

    return GenerateOTPOut(code=code, expires_at=handoff.otp_expires_at)


@router.post("/{handoff_id}/verify-otp", response_model=HandoffOut)
def verify_otp(handoff_id: str, payload: OTPVerify, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    handoff = _get_handoff_or_404(db, handoff_id)
    req = db.query(Request).filter(Request.id == handoff.request_id).first()
    if req.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the requester can verify a handoff code")
    if handoff.status != HandoffStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This handoff is already complete")
    if handoff.otp_hash is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active code — ask the traveler to generate one")
    if handoff.otp_expires_at < utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This code has expired — ask the traveler to generate a new one")
    if handoff.otp_attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many incorrect attempts — ask the traveler to generate a new code")

    if not secrets.compare_digest(_hash_code(payload.code), handoff.otp_hash):
        handoff.otp_attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect code")

    # Correct code: complete everything in one step (see README for why there's no
    # separate PENDING -> VERIFIED -> [later] COMPLETED API call — nothing in the spec's
    # endpoint list needs a second action here, so this does it all atomically).
    now = utcnow()
    handoff.status = HandoffStatus.COMPLETED
    handoff.completed_at = now
    trip = db.query(Trip).filter(Trip.id == handoff.trip_id).first()
    trip.status = TripStatus.COMPLETED
    req.status = RequestStatus.COMPLETED
    db.commit()
    db.refresh(handoff)
    return handoff


@router.get("/{handoff_id}", response_model=HandoffOut)
def get_handoff(handoff_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    handoff = _get_handoff_or_404(db, handoff_id)
    trip = db.query(Trip).filter(Trip.id == handoff.trip_id).first()
    req = db.query(Request).filter(Request.id == handoff.request_id).first()
    if current_user.id not in (trip.user_id, req.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this handoff")
    return handoff
