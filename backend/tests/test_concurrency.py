"""
Concurrency regression tests.

These deliberately do NOT use the shared `client`/`db_engine` fixtures from conftest.py:
those use an in-memory SQLite database with StaticPool, which pins every "connection" to
the same single underlying connection object — fine for every other test in this suite,
but it can't reproduce a real write-write race at all, since BEGIN IMMEDIATE (see
database.build_engine) has nothing to lock against when there's only one real connection.

Both tests here build a real temp *file* database instead, through the exact same
database.build_engine(...) factory production uses, so they're genuinely exercising the
same locking behavior — each was first proven by hand against a live uvicorn process
(10/10 trials, exactly one winner each time) before being captured here as a permanent,
automated check. Each was also confirmed to actually catch a regression: temporarily
reverting database.py's BEGIN IMMEDIATE back to a plain (deferred) BEGIN made both of
these fail reliably, proving they're not just trivially passing regardless.
"""

import os
import tempfile
import threading

from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from database import Base, build_engine, get_db
from main import app


def _login(client, email: str, name: str) -> str:
    client.post("/auth/register", json={"name": name, "email": email, "password": "password123"})
    return client.post("/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]


def _post_trip(client, headers, **overrides):
    payload = {"origin": "Hyderabad", "destination": "Warangal", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3}
    payload.update(overrides)
    return client.post("/trips", headers=headers, json=payload).json()


def _post_request(client, headers, **overrides):
    payload = {"pickup_location": "Hyderabad", "delivery_location": "Warangal", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "MEDIUM"}
    payload.update(overrides)
    return client.post("/requests", headers=headers, json=payload).json()


def _file_backed_client():
    """A TestClient wired to a real temp-file SQLite database via the production
    build_engine(...) factory. Caller is responsible for cleanup — see the `finally`
    blocks below."""
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
    return TestClient(app), db_path


def test_concurrent_accept_attempts_on_the_same_single_capacity_trip_cannot_both_succeed():
    # Found during review: SQLite's default (deferred) transaction mode doesn't acquire a
    # write lock until the first write statement runs, so two concurrent accept requests
    # could both read a trip as ACTIVE before either committed, and both succeed — a
    # capacity-1 trip got double-booked under real concurrent load.
    client, db_path = _file_backed_client()
    try:
        traveler_headers = {"Authorization": f"Bearer {_login(client, 'trav_accept_race@example.com', 'Traveler')}"}
        _post_trip(client, traveler_headers, available_capacity=1)

        requester_headers = []
        match_ids = []
        for i in range(2):
            headers = {"Authorization": f"Bearer {_login(client, f'racer{i}@example.com', f'Racer{i}')}"}
            req = _post_request(client, headers, item_size="SMALL")  # must fit the trip's capacity=1
            match_id = client.get(f"/matches/{req['id']}", headers=headers).json()[0]["match_id"]
            requester_headers.append(headers)
            match_ids.append(match_id)

        results = [None, None]

        def accept(i):
            results[i] = client.post(f"/matches/{match_ids[i]}/accept", headers=requester_headers[i]).status_code

        threads = [threading.Thread(target=accept, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly one should succeed (201) and the other should be cleanly rejected (409)
        # -- never both succeeding, and never a raw 500 from an unhandled "database is
        # locked" (which is what a missing/insufficient busy timeout would produce).
        assert sorted(results) == [201, 409]
    finally:
        app.dependency_overrides.clear()
        os.remove(db_path)


def test_concurrent_otp_verification_attempts_cannot_both_complete_the_handoff():
    # Same race-condition class as above, but for handoff completion (Phase 8 names this
    # as its own concern). Two threads submit the SAME correct code to the SAME handoff
    # simultaneously — without the fix, both could read status=PENDING before either
    # committed, and both would mark the trip/request COMPLETED, applying any completion
    # side effects (e.g. a reputation change, in a version of this app that had one) twice.
    client, db_path = _file_backed_client()
    try:
        traveler_headers = {"Authorization": f"Bearer {_login(client, 'trav_otp_race@example.com', 'Traveler')}"}
        requester_headers = {"Authorization": f"Bearer {_login(client, 'req_otp_race@example.com', 'Requester')}"}
        _post_trip(client, traveler_headers)
        req = _post_request(client, requester_headers)
        match_id = client.get(f"/matches/{req['id']}", headers=requester_headers).json()[0]["match_id"]
        handoff_id = client.post(f"/matches/{match_id}/accept", headers=requester_headers).json()["handoff_id"]
        code = client.post(f"/handoffs/{handoff_id}/generate-otp", headers=traveler_headers).json()["code"]

        results = [None, None]

        def verify(i):
            results[i] = client.post(f"/handoffs/{handoff_id}/verify-otp", headers=requester_headers, json={"code": code}).status_code

        threads = [threading.Thread(target=verify, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly one verification should succeed (200); the other must be cleanly
        # rejected (409, "already complete") -- never both succeeding.
        assert sorted(results) == [200, 409]
    finally:
        app.dependency_overrides.clear()
        os.remove(db_path)
