"""
Performance regression tests.

Both tests here found real bugs during review: GET /matches and GET /handoffs each issued
one extra SQL query per distinct trip owner involved, because TripOut/RequestOut's
owner_name property lazily loads trip.owner/request.owner and neither endpoint originally
eager-loaded it. Confirmed empirically (5 candidate trips from 5 different travelers -> 9
queries for /matches; 4 handoffs from 4 different travelers -> 15 queries for /handoffs)
before being fixed with joinedload in routes/matches.py and routes/handoffs.py. These tests
assert an upper bound on query count that would be violated by a regression back to the N+1
pattern, using the same query-counting technique used to find the bug in the first place.
"""

import os
import tempfile

from sqlalchemy import event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from database import Base, build_engine, get_db
from main import app


def _login(client, email: str, name: str) -> str:
    client.post("/auth/register", json={"name": name, "email": email, "password": "password123"})
    return client.post("/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]


def _file_backed_client():
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = build_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), engine, db_path


def _count_queries(engine, action):
    count = [0]

    def _listener(conn, cursor, statement, parameters, context, executemany):
        count[0] += 1

    event.listen(engine, "before_cursor_execute", _listener)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", _listener)
    return count[0]


def test_matches_query_count_does_not_scale_with_number_of_distinct_trip_owners():
    client, engine, db_path = _file_backed_client()
    try:
        requester_headers = {"Authorization": f"Bearer {_login(client, 'requester@perf.com', 'Requester')}"}

        # 6 different travelers, all posting compatible trips
        for i in range(6):
            headers = {"Authorization": f"Bearer {_login(client, f'traveler{i}@perf.com', f'Traveler{i}')}"}
            client.post("/trips", headers=headers, json={"origin": "Hyderabad", "destination": "Warangal", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3})

        req = client.post("/requests", headers=requester_headers, json={"pickup_location": "Hyderabad", "delivery_location": "Warangal", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "SMALL"}).json()

        result = {}

        def call():
            result["response"] = client.get(f"/matches/{req['id']}", headers=requester_headers)

        query_count = _count_queries(engine, call)
        assert result["response"].status_code == 200
        assert len(result["response"].json()) == 6  # sanity check: all 6 trips actually matched

        # A fixed small number regardless of trip count (BEGIN + current_user + request +
        # trips-with-joined-owners) -- if this regresses to N+1, it would be roughly
        # 4 + 6 = 10, not <= 6.
        assert query_count <= 6, f"expected a flat, non-scaling query count, got {query_count}"
    finally:
        app.dependency_overrides.clear()
        os.remove(db_path)


def test_list_handoffs_query_count_does_not_scale_with_number_of_handoffs():
    client, engine, db_path = _file_backed_client()
    try:
        requester_headers = {"Authorization": f"Bearer {_login(client, 'requester2@perf.com', 'Requester2')}"}

        # 5 different travelers, 5 separate accepted handoffs for the same requester
        for i in range(5):
            traveler_headers = {"Authorization": f"Bearer {_login(client, f'traveler2_{i}@perf.com', f'Traveler2_{i}')}"}
            client.post("/trips", headers=traveler_headers, json={"origin": f"City{i}", "destination": f"Dest{i}", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3})
            req = client.post("/requests", headers=requester_headers, json={"pickup_location": f"City{i}", "delivery_location": f"Dest{i}", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "SMALL"}).json()
            match_id = client.get(f"/matches/{req['id']}", headers=requester_headers).json()[0]["match_id"]
            client.post(f"/matches/{match_id}/accept", headers=requester_headers)

        result = {}

        def call():
            result["response"] = client.get("/handoffs", headers=requester_headers)

        query_count = _count_queries(engine, call)
        assert result["response"].status_code == 200
        assert len(result["response"].json()) == 5

        # BEGIN + current_user + one joined handoffs-with-trips-and-requests-and-owners
        # query -- if this regresses to N+1, it would scale roughly linearly with handoff
        # count (was 15 for 4 handoffs before the fix), not stay this low.
        assert query_count <= 4, f"expected a flat, non-scaling query count, got {query_count}"
    finally:
        app.dependency_overrides.clear()
        os.remove(db_path)
