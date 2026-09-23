"""
Deterministic matching engine. Every function here is pure — no database access, no
side effects — so the whole thing can be unit-tested by constructing plain objects and
checking the output directly (see tests/test_matching.py). Route code (routes/matches.py)
is responsible for fetching candidates from the database; this module only ever evaluates
compatibility and score for a (trip, request) pair it's handed.

Compatibility (all four must hold for a match to exist at all):
  1. Location  — normalized exact match: trip.origin == request.pickup_location AND
                 trip.destination == request.delivery_location. No fuzzy matching, no
                 geocoding — see README for why that's a deliberate choice, not a gap.
  2. Time      — trip.departure_time falls within [request.earliest_time, request.latest_time].
  3. Capacity  — trip.available_capacity >= request.item_size.
  4. Status    — trip is ACTIVE and request is OPEN.

Scoring (only computed for pairs that already passed all four checks above):
  Same origin: +40, same destination: +40 — these are effectively constant across any
  match this module ever returns, since location compatibility is a hard requirement, not
  a bonus. What actually differentiates matches from each other is the time score (0-20),
  based on how centered the departure time is within the request's acceptable window —
  a trip departing near the middle of the window has more real-world buffer on both sides
  than one departing right at an edge, which is a genuinely useful (if simple) signal for
  "how comfortable is this match," not just padding for the score to look graded.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class TripLike:
    """Minimal shape matching.py actually needs from a Trip — decoupled from the
    SQLAlchemy model so these functions can be tested with plain objects, no DB required."""
    id: str
    origin: str
    destination: str
    departure_time: datetime
    available_capacity: int
    status: str  # compared against the string "ACTIVE" — see is_status_compatible


@dataclass
class RequestLike:
    id: str
    pickup_location: str
    delivery_location: str
    earliest_time: datetime
    latest_time: datetime
    item_size: int
    status: str  # compared against "OPEN"


@dataclass
class MatchResult:
    score: int
    reasons: list[str]


def _normalize(s: str) -> str:
    return s.strip().lower()


def is_location_compatible(trip: TripLike, request: RequestLike) -> bool:
    return (
        _normalize(trip.origin) == _normalize(request.pickup_location)
        and _normalize(trip.destination) == _normalize(request.delivery_location)
    )


def is_time_compatible(trip: TripLike, request: RequestLike) -> bool:
    return request.earliest_time <= trip.departure_time <= request.latest_time


def is_capacity_compatible(trip: TripLike, request: RequestLike) -> bool:
    return trip.available_capacity >= request.item_size


def is_status_compatible(trip: TripLike, request: RequestLike) -> bool:
    return trip.status == "ACTIVE" and request.status == "OPEN"


def is_compatible(trip: TripLike, request: RequestLike) -> bool:
    return (
        is_location_compatible(trip, request)
        and is_time_compatible(trip, request)
        and is_capacity_compatible(trip, request)
        and is_status_compatible(trip, request)
    )


def _time_score(trip: TripLike, request: RequestLike) -> tuple[int, str]:
    """0-20 points, plus a human-readable reason. Only meaningful for a pair that's already
    time-compatible — callers must check that first (compute_match does)."""
    window_seconds = (request.latest_time - request.earliest_time).total_seconds()
    if window_seconds <= 0:
        return 0, "Time overlap within window"

    margin_seconds = min(
        (trip.departure_time - request.earliest_time).total_seconds(),
        (request.latest_time - trip.departure_time).total_seconds(),
    )
    half_window = window_seconds / 2
    ratio = min(margin_seconds / half_window, 1.0) if half_window > 0 else 1.0
    score = round(20 * ratio)

    if score >= 15:
        reason = "Excellent time overlap"
    elif score >= 8:
        reason = "Good time overlap"
    else:
        reason = "Time overlap within window"
    return score, reason


def compute_match(trip: TripLike, request: RequestLike) -> MatchResult | None:
    """Returns None if the pair isn't compatible at all; otherwise a score (80-100, given
    the scoring design above) and a list of plain-language reasons."""
    if not is_compatible(trip, request):
        return None

    time_pts, time_reason = _time_score(trip, request)
    reasons = ["Same origin", "Same destination", time_reason]
    return MatchResult(score=40 + 40 + time_pts, reasons=reasons)


def find_matches(request: RequestLike, candidate_trips: list[TripLike]) -> list[tuple[TripLike, MatchResult]]:
    """Evaluates every candidate trip against one request, keeps only the compatible ones,
    and returns them sorted best-first. Candidate fetching (which trips to even consider)
    is the route layer's job — this function just scores whatever it's handed."""
    scored = []
    for trip in candidate_trips:
        result = compute_match(trip, request)
        if result is not None:
            scored.append((trip, result))
    scored.sort(key=lambda pair: pair[1].score, reverse=True)
    return scored
