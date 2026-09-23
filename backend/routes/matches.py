from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Trip, Request, Handoff, TripStatus, RequestStatus, User
from schemas import MatchOut, AcceptMatchOut
from auth import get_current_user
from matching import TripLike, RequestLike, find_matches, compute_match

router = APIRouter()


def _to_trip_like(trip: Trip) -> TripLike:
    return TripLike(
        id=trip.id, origin=trip.origin, destination=trip.destination,
        departure_time=trip.departure_time, available_capacity=trip.available_capacity,
        status=trip.status.value,
    )


def _to_request_like(req: Request) -> RequestLike:
    return RequestLike(
        id=req.id, pickup_location=req.pickup_location, delivery_location=req.delivery_location,
        earliest_time=req.earliest_time, latest_time=req.latest_time, item_size=req.item_size,
        status=req.status.value,
    )


@router.get("/{request_id}", response_model=list[MatchOut])
def get_matches_for_request(request_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(Request).filter(Request.id == request_id).first()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this request")

    # Every ACTIVE trip is a candidate — matching.find_matches does the actual filtering
    # and scoring; this route's only job is fetching candidates and shaping the response.
    # A real N+1 found during review: TripOut.owner_name reads trip.owner.name, and
    # without eager loading, each DISTINCT traveler among the candidate trips triggered its
    # own separate "SELECT * FROM users WHERE id = ?" -- confirmed by actually counting SQL
    # statements (5 candidate trips from 5 different travelers produced 9 total queries for
    # one request). joinedload fetches every candidate trip's owner in the same query via a
    # SQL JOIN, so this stays flat regardless of how many distinct travelers are involved.
    candidate_trips = db.query(Trip).options(joinedload(Trip.owner)).filter(Trip.status == TripStatus.ACTIVE).all()
    scored = find_matches(_to_request_like(req), [_to_trip_like(t) for t in candidate_trips])

    trips_by_id = {t.id: t for t in candidate_trips}
    return [
        MatchOut(match_id=f"{trip_like.id}:{req.id}", trip=trips_by_id[trip_like.id], score=result.score, reasons=result.reasons)
        for trip_like, result in scored
    ]


@router.post("/{match_id}/accept", response_model=AcceptMatchOut, status_code=status.HTTP_201_CREATED)
def accept_match(match_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # match_id is never trusted as-is — it's just a hint for which two rows to re-check.
    # Everything about whether this match is actually valid gets recomputed here, fresh,
    # against the database's current state (Section 10: verify request/trip/match are all
    # still valid at accept time, not just at whenever GET /matches was last called).
    parts = match_id.split(":")
    if len(parts) != 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid match id")
    trip_id, request_id = parts

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    req = db.query(Request).filter(Request.id == request_id).first()
    if trip is None or req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip or request not found")

    # Only the requester decides which compatible trip to go with — the traveler doesn't
    # separately "approve" a match in this simplified flow (see README).
    if req.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the requester can accept a match for their own request")

    if compute_match(_to_trip_like(trip), _to_request_like(req)) is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This match is no longer valid")

    existing_handoff = db.query(Handoff).filter(Handoff.request_id == req.id).first()
    if existing_handoff is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This request already has an accepted match")

    # Every operation on `db` in this function happens inside one transaction that acquired
    # its write lock immediately, at the very first query above (see database.py's
    # BEGIN IMMEDIATE setup) — not lazily. That's what actually prevents two concurrent
    # accept attempts on the same trip from both reading it as ACTIVE: whichever request's
    # transaction starts second is genuinely blocked until the first one commits, so it
    # re-reads the trip as already MATCHED rather than racing against stale data. This was a
    # real bug (proven with an actual concurrent test), not a theoretical concern — see
    # database.py's comment for what SQLite does by default without this.
    handoff = Handoff(trip_id=trip.id, request_id=req.id)
    trip.status = TripStatus.MATCHED
    req.status = RequestStatus.MATCHED
    db.add(handoff)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This request already has an accepted match")
    db.refresh(handoff)
    db.refresh(trip)
    db.refresh(req)

    return AcceptMatchOut(handoff_id=handoff.id, trip=trip, request=req, status=handoff.status)
