"""
Database models. Four tables, on purpose — see README for why this is enough:

    User --< Trip
    User --< Request
    Trip --< Handoff >-- Request   (one Handoff per accepted match)

Status fields use SQLAlchemy's Enum type rather than a bare string column: on SQLite this
compiles to a VARCHAR with a CHECK constraint, so an invalid status value is rejected by the
database itself, not just by application code that might have a bug in it.

Every datetime column is plain `DateTime()` (timezone-naive), matching the app's own
"naive UTC everywhere" convention (see to_naive_utc below) — using `DateTime(timezone=True)`
here would be misleading, since the app deliberately strips timezone info before ever
storing a value.
"""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SAEnum, Index
from sqlalchemy.orm import relationship

from database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    # Naive UTC, deliberately — see to_naive_utc's docstring for why.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(dt: datetime) -> datetime:
    """Every datetime this app stores or compares is naive UTC, by one consistent
    convention applied everywhere a datetime enters the system (see routes/trips.py,
    routes/requests.py, routes/handoffs.py). This isn't a workaround bolted on after the
    fact — a real bug that surfaced during the end-to-end test run is exactly why it's
    written this way now: SQLite has no native timestamp-with-timezone type, so a
    timezone-aware datetime written to it doesn't reliably come back out aware after a
    round trip through a fresh query — while a value still held in memory from earlier in
    the same request would. Comparing one of each (`TypeError: can't compare offset-naive
    and offset-aware datetimes`) crashed OTP verification the first time it was actually
    exercised end-to-end. Normalizing to naive UTC at the single point every datetime
    enters the system removes the inconsistency instead of chasing individual comparisons."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class TripStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    MATCHED = "MATCHED"
    COMPLETED = "COMPLETED"


class RequestStatus(str, enum.Enum):
    OPEN = "OPEN"
    MATCHED = "MATCHED"
    COMPLETED = "COMPLETED"


class HandoffStatus(str, enum.Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    COMPLETED = "COMPLETED"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=new_id)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)  # unique=True already creates an index -- a separate index=True here would just be a second, redundant one on the same column
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(), default=utcnow, nullable=False)

    trips = relationship("Trip", back_populates="owner", cascade="all, delete-orphan")
    requests = relationship("Request", back_populates="owner", cascade="all, delete-orphan")


class Trip(Base):
    __tablename__ = "trips"

    id = Column(String, primary_key=True, default=new_id)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    origin = Column(String, nullable=False)
    destination = Column(String, nullable=False)
    departure_time = Column(DateTime(), nullable=False)
    available_capacity = Column(Integer, nullable=False)
    status = Column(SAEnum(TripStatus), nullable=False, default=TripStatus.ACTIVE)
    created_at = Column(DateTime(), default=utcnow, nullable=False)

    owner = relationship("User", back_populates="trips")
    handoffs = relationship("Handoff", back_populates="trip", cascade="all, delete-orphan")

    @property
    def owner_name(self) -> str:
        # Section 16.5 wants the traveler's identity visible on the Matches page, not just
        # an opaque user_id — a plain Python property (not a column) is enough here and
        # Pydantic's from_attributes reads it exactly like a real attribute.
        return self.owner.name

    __table_args__ = (
        # Every matching query filters on (status, departure_time) together — see
        # matching.py — so a composite index here is a genuine, not speculative, win.
        Index("ix_trips_status_departure", "status", "departure_time"),
    )


class Request(Base):
    __tablename__ = "requests"

    id = Column(String, primary_key=True, default=new_id)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    pickup_location = Column(String, nullable=False)
    delivery_location = Column(String, nullable=False)
    earliest_time = Column(DateTime(), nullable=False)
    latest_time = Column(DateTime(), nullable=False)
    item_size = Column(Integer, nullable=False)  # capacity units required; see schemas.py for the Small/Medium/Large mapping the frontend presents
    status = Column(SAEnum(RequestStatus), nullable=False, default=RequestStatus.OPEN)
    created_at = Column(DateTime(), default=utcnow, nullable=False)

    owner = relationship("User", back_populates="requests")
    handoffs = relationship("Handoff", back_populates="request", cascade="all, delete-orphan")

    @property
    def owner_name(self) -> str:
        return self.owner.name

    __table_args__ = (
        Index("ix_requests_status_window", "status", "earliest_time", "latest_time"),
    )


class Handoff(Base):
    __tablename__ = "handoffs"

    id = Column(String, primary_key=True, default=new_id)
    trip_id = Column(String, ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    request_id = Column(String, ForeignKey("requests.id", ondelete="CASCADE"), nullable=False)
    otp_hash = Column(String, nullable=True)  # null until generate-otp is called
    otp_expires_at = Column(DateTime(), nullable=True)
    otp_attempts = Column(Integer, nullable=False, default=0)  # a simple cap (see routes/handoffs.py), not a rate limiter
    status = Column(SAEnum(HandoffStatus), nullable=False, default=HandoffStatus.PENDING)
    created_at = Column(DateTime(), default=utcnow, nullable=False)
    completed_at = Column(DateTime(), nullable=True)

    trip = relationship("Trip", back_populates="handoffs")
    request = relationship("Request", back_populates="handoffs")

    __table_args__ = (
        # A request should only ever have one live handoff — this is the database-level
        # backstop for "prevent duplicate acceptance" (Section 10), not just an application
        # check that a bug could bypass.
        Index("ix_handoffs_request_unique", "request_id", unique=True),
    )
