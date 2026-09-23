from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Trip, TripStatus, User, to_naive_utc
from schemas import TripCreate, TripOut
from auth import get_current_user

router = APIRouter()


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trip = Trip(
        user_id=current_user.id,  # from the verified session, never from the request body
        origin=payload.origin,
        destination=payload.destination,
        departure_time=to_naive_utc(payload.departure_time),
        available_capacity=payload.available_capacity,
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


@router.get("", response_model=list[TripOut])
def list_my_trips(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """The caller's own trips, for their dashboard -- not a public browse of everyone's
    trips (matching, in routes/matches.py, is the cross-user query; this isn't)."""
    return db.query(Trip).filter(Trip.user_id == current_user.id).order_by(Trip.created_at.desc()).all()


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this trip")
    return trip


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this trip")
    if trip.status != TripStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an active trip can be deleted")
    db.delete(trip)
    db.commit()
