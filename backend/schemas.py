"""
Pydantic schemas. Naming convention used throughout: `*Create` for what a client sends in,
`*Out` for what the API returns — so it's never ambiguous which direction a schema is for.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from models import TripStatus, RequestStatus, HandoffStatus

# Item size is presented to the user as Small/Medium/Large but stored and compared as a
# plain integer "capacity unit" — this mapping is the one place that translation happens,
# so the frontend and backend can't drift out of sync on what "Medium" means.
ITEM_SIZE_UNITS = {"SMALL": 1, "MEDIUM": 2, "LARGE": 3}


# --- Auth ---

class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    # bcrypt only uses the first 72 bytes of a password — capping here at 72 characters
    # means every character a user types actually contributes to the hash, rather than
    # silently allowing a longer password whose tail bytes are ignored.
    password: str = Field(min_length=8, max_length=72)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- Trips ---

class TripCreate(BaseModel):
    origin: str = Field(min_length=1, max_length=100)
    destination: str = Field(min_length=1, max_length=100)
    departure_time: datetime
    available_capacity: int = Field(ge=1, le=10)

    @field_validator("origin", "destination")
    @classmethod
    def normalize_place(cls, v: str) -> str:
        # Matching compares these with a simple case/whitespace-insensitive equality (see
        # matching.py) — normalizing on the way in means that comparison never has to
        # second-guess formatting, and what's stored is already what gets displayed.
        return " ".join(v.strip().split())

    @field_validator("destination")
    @classmethod
    def destination_differs_from_origin(cls, v: str, info) -> str:
        origin = info.data.get("origin")
        if origin and v.strip().lower() == origin.strip().lower():
            raise ValueError("destination must be different from origin")
        return v


class TripOut(BaseModel):
    id: str
    user_id: str
    owner_name: str
    origin: str
    destination: str
    departure_time: datetime
    available_capacity: int
    status: TripStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Requests ---

class RequestCreate(BaseModel):
    pickup_location: str = Field(min_length=1, max_length=100)
    delivery_location: str = Field(min_length=1, max_length=100)
    earliest_time: datetime
    latest_time: datetime
    item_size: str = Field(pattern="^(SMALL|MEDIUM|LARGE)$")

    @field_validator("pickup_location", "delivery_location")
    @classmethod
    def normalize_place(cls, v: str) -> str:
        return " ".join(v.strip().split())

    @field_validator("latest_time")
    @classmethod
    def latest_after_earliest(cls, v: datetime, info) -> datetime:
        earliest = info.data.get("earliest_time")
        if earliest and v <= earliest:
            raise ValueError("latest_time must be after earliest_time")
        return v


class RequestOut(BaseModel):
    id: str
    user_id: str
    owner_name: str
    pickup_location: str
    delivery_location: str
    earliest_time: datetime
    latest_time: datetime
    item_size: int
    status: RequestStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Matches (computed, not persisted — see matching.py) ---

class MatchOut(BaseModel):
    match_id: str  # composite "{trip_id}:{request_id}", re-validated server-side on accept, never trusted as-is
    trip: TripOut
    score: int
    reasons: list[str]


class AcceptMatchOut(BaseModel):
    handoff_id: str
    trip: TripOut
    request: RequestOut
    status: HandoffStatus


# --- Handoffs ---

class OTPVerify(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern="^[0-9]{6}$")


class GenerateOTPOut(BaseModel):
    # The plaintext code is returned exactly once, here, to the traveler who generated it —
    # never stored in plaintext (see routes/handoffs.py), never returned by any other endpoint.
    code: str
    expires_at: datetime


class HandoffOut(BaseModel):
    id: str
    trip_id: str
    request_id: str
    status: HandoffStatus
    otp_expires_at: Optional[datetime]
    created_at: datetime
    completed_at: Optional[datetime]
    # Both parties to a handoff need to see the shared trip/request context (route, timing)
    # even though the plain GET /trips/{id} and GET /requests/{id} endpoints are correctly
    # locked to just the poster of each — a handoff is the one place both participants'
    # view legitimately overlaps, so it carries both nested here rather than loosening
    # ownership rules on the trip/request endpoints themselves.
    trip: TripOut
    request: RequestOut

    model_config = ConfigDict(from_attributes=True)
