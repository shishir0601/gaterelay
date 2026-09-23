from datetime import datetime, timedelta, timezone

from matching import (
    TripLike, RequestLike, compute_match, find_matches,
    is_location_compatible, is_time_compatible, is_capacity_compatible, is_status_compatible,
)

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def make_trip(**overrides):
    defaults = dict(
        id="trip-1", origin="Hyderabad", destination="Warangal",
        departure_time=NOW, available_capacity=3, status="ACTIVE",
    )
    defaults.update(overrides)
    return TripLike(**defaults)


def make_request(**overrides):
    defaults = dict(
        id="req-1", pickup_location="Hyderabad", delivery_location="Warangal",
        earliest_time=NOW - timedelta(hours=2), latest_time=NOW + timedelta(hours=2),
        item_size=2, status="OPEN",
    )
    defaults.update(overrides)
    return RequestLike(**defaults)


# --- valid match ---

def test_valid_match_returns_a_result():
    result = compute_match(make_trip(), make_request())
    assert result is not None
    assert result.score >= 80
    assert "Same origin" in result.reasons
    assert "Same destination" in result.reasons


def test_location_matching_is_case_and_whitespace_insensitive():
    trip = make_trip(origin="  hyderabad ", destination="WARANGAL")
    req = make_request(pickup_location="Hyderabad", delivery_location="warangal")
    assert is_location_compatible(trip, req) is True


# --- wrong origin / destination ---

def test_wrong_origin_is_not_compatible():
    trip = make_trip(origin="Mumbai")
    assert is_location_compatible(trip, make_request()) is False
    assert compute_match(trip, make_request()) is None


def test_wrong_destination_is_not_compatible():
    trip = make_trip(destination="Bangalore")
    assert is_location_compatible(trip, make_request()) is False
    assert compute_match(trip, make_request()) is None


# --- time ---

def test_departure_outside_window_is_incompatible():
    trip = make_trip(departure_time=NOW + timedelta(hours=5))  # request window is NOW-2h to NOW+2h
    assert is_time_compatible(trip, make_request()) is False
    assert compute_match(trip, make_request()) is None


def test_departure_at_exact_window_edge_is_compatible():
    req = make_request()
    trip = make_trip(departure_time=req.earliest_time)
    assert is_time_compatible(trip, req) is True


def test_departure_centered_in_window_scores_higher_than_near_the_edge():
    req = make_request(earliest_time=NOW, latest_time=NOW + timedelta(hours=4))
    centered = make_trip(departure_time=NOW + timedelta(hours=2))
    near_edge = make_trip(departure_time=NOW + timedelta(minutes=5))
    centered_result = compute_match(centered, req)
    edge_result = compute_match(near_edge, req)
    assert centered_result.score > edge_result.score


def test_excellent_time_overlap_reason_for_centered_departure():
    req = make_request(earliest_time=NOW, latest_time=NOW + timedelta(hours=4))
    trip = make_trip(departure_time=NOW + timedelta(hours=2))
    result = compute_match(trip, req)
    assert "Excellent time overlap" in result.reasons


# --- capacity ---

def test_insufficient_capacity_is_incompatible():
    trip = make_trip(available_capacity=1)
    req = make_request(item_size=2)
    assert is_capacity_compatible(trip, req) is False
    assert compute_match(trip, req) is None


def test_exact_capacity_match_is_compatible():
    trip = make_trip(available_capacity=2)
    req = make_request(item_size=2)
    assert is_capacity_compatible(trip, req) is True


# --- status ---

def test_inactive_trip_is_incompatible():
    trip = make_trip(status="COMPLETED")
    assert is_status_compatible(trip, make_request()) is False
    assert compute_match(trip, make_request()) is None


def test_non_open_request_is_incompatible():
    req = make_request(status="MATCHED")
    assert is_status_compatible(make_trip(), req) is False
    assert compute_match(make_trip(), req) is None


# --- find_matches: multiple candidates, sorting ---

def test_find_matches_excludes_incompatible_trips():
    req = make_request()
    trips = [make_trip(id="a"), make_trip(id="b", origin="Mumbai"), make_trip(id="c", status="COMPLETED")]
    results = find_matches(req, trips)
    assert [trip.id for trip, _ in results] == ["a"]


def test_find_matches_sorts_best_first():
    req = make_request(earliest_time=NOW, latest_time=NOW + timedelta(hours=4))
    centered = make_trip(id="centered", departure_time=NOW + timedelta(hours=2))
    near_edge = make_trip(id="edge", departure_time=NOW + timedelta(minutes=5))
    results = find_matches(req, [near_edge, centered])  # deliberately passed in the "wrong" order
    assert [trip.id for trip, _ in results] == ["centered", "edge"]


def test_find_matches_returns_empty_list_when_nothing_compatible():
    req = make_request()
    results = find_matches(req, [make_trip(origin="Mumbai")])
    assert results == []
