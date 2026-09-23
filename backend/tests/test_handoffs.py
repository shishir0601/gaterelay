import pytest


@pytest.fixture()
def accepted_handoff(client, auth_headers, second_auth_headers):
    """auth_headers = traveler, second_auth_headers = requester. Returns the handoff_id."""
    client.post("/trips", headers=auth_headers, json={"origin": "Hyderabad", "destination": "Warangal", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3})
    req = client.post("/requests", headers=second_auth_headers, json={"pickup_location": "Hyderabad", "delivery_location": "Warangal", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "MEDIUM"}).json()
    match_id = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]["match_id"]
    accept = client.post(f"/matches/{match_id}/accept", headers=second_auth_headers).json()
    return accept["handoff_id"]


def test_generate_otp(client, auth_headers, accepted_handoff):
    res = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert len(body["code"]) == 6
    assert body["code"].isdigit()


def test_only_traveler_can_generate_otp(client, second_auth_headers, accepted_handoff):
    res = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=second_auth_headers)
    assert res.status_code == 403


def test_correct_otp_completes_the_handoff(client, auth_headers, second_auth_headers, accepted_handoff):
    code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": code})
    assert res.status_code == 200
    assert res.json()["status"] == "COMPLETED"


def test_incorrect_otp_is_rejected(client, auth_headers, second_auth_headers, accepted_handoff):
    real_code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    wrong_code = "000000" if real_code != "000000" else "111111"
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": wrong_code})
    assert res.status_code == 400


def test_only_requester_can_verify_otp(client, auth_headers, second_auth_headers, accepted_handoff):
    code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=auth_headers, json={"code": code})  # traveler tries to verify their own code
    assert res.status_code == 403


def test_already_completed_handoff_rejects_further_verification(client, auth_headers, second_auth_headers, accepted_handoff):
    code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": code})
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": code})
    assert res.status_code == 409


def test_verifying_before_any_otp_generated_is_rejected(client, second_auth_headers, accepted_handoff):
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": "123456"})
    assert res.status_code == 400


def test_malformed_otp_is_rejected_by_validation_not_a_crash(client, auth_headers, second_auth_headers, accepted_handoff):
    # Explicitly named in the original test checklist and, until now, never actually
    # exercised -- OTPVerify's schema pattern (^[0-9]{6}$) should reject these at the
    # validation layer (422), never reach the hashing/comparison logic at all.
    client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers)
    for bad_code in ["abcdef", "12345", "1234567", "", "12 456", "-23456"]:
        res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": bad_code})
        assert res.status_code == 422, f"expected 422 for code={bad_code!r}, got {res.status_code}"


def test_expired_otp_is_rejected(client, auth_headers, second_auth_headers, accepted_handoff, db_engine):
    code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]

    # Force the expiry into the past directly in the DB — this is the same technique a real
    # test suite uses to test time-based logic without actually sleeping for 10 minutes.
    from sqlalchemy.orm import sessionmaker
    from models import Handoff
    from datetime import timedelta
    from models import utcnow

    Session = sessionmaker(bind=db_engine)
    db = Session()
    handoff = db.query(Handoff).filter(Handoff.id == accepted_handoff).first()
    handoff.otp_expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    db.close()

    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": code})
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()


def test_too_many_incorrect_attempts_locks_out_further_guessing(client, auth_headers, second_auth_headers, accepted_handoff):
    real_code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    wrong_code = "000000" if real_code != "000000" else "111111"
    for _ in range(5):
        res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": wrong_code})
        assert res.status_code == 400
    # the 6th attempt is locked out even though we never actually tried the real code
    locked = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": real_code})
    assert locked.status_code == 400
    assert "too many" in locked.json()["detail"].lower()


def test_regenerating_otp_resets_the_attempt_count(client, auth_headers, second_auth_headers, accepted_handoff):
    first_code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    wrong_code = "000000" if first_code != "000000" else "111111"
    for _ in range(5):
        client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": wrong_code})

    new_code = client.post(f"/handoffs/{accepted_handoff}/generate-otp", headers=auth_headers).json()["code"]
    res = client.post(f"/handoffs/{accepted_handoff}/verify-otp", headers=second_auth_headers, json={"code": new_code})
    assert res.status_code == 200  # not locked out anymore — regenerating gave a fresh budget


def test_get_handoff_visible_to_both_parties_only(client, auth_headers, second_auth_headers, accepted_handoff):
    assert client.get(f"/handoffs/{accepted_handoff}", headers=auth_headers).status_code == 200
    assert client.get(f"/handoffs/{accepted_handoff}", headers=second_auth_headers).status_code == 200

    client.post("/auth/register", json={"name": "Stranger", "email": "stranger@example.com", "password": "password123"})
    stranger_token = client.post("/auth/login", json={"email": "stranger@example.com", "password": "password123"}).json()["access_token"]
    res = client.get(f"/handoffs/{accepted_handoff}", headers={"Authorization": f"Bearer {stranger_token}"})
    assert res.status_code == 403


def test_handoff_response_never_includes_the_otp_hash(client, auth_headers, second_auth_headers, accepted_handoff):
    res = client.get(f"/handoffs/{accepted_handoff}", headers=auth_headers)
    assert "otp_hash" not in res.json()


def test_handoff_includes_trip_and_request_details_for_both_parties(client, auth_headers, second_auth_headers, accepted_handoff):
    # Both the traveler and requester can see the shared route/timing context, even though
    # the plain GET /trips/{id} and GET /requests/{id} are locked to just the poster of each.
    traveler_view = client.get(f"/handoffs/{accepted_handoff}", headers=auth_headers).json()
    assert traveler_view["trip"]["origin"] == "Hyderabad"
    assert traveler_view["request"]["pickup_location"] == "Hyderabad"

    requester_view = client.get(f"/handoffs/{accepted_handoff}", headers=second_auth_headers).json()
    assert requester_view["trip"]["destination"] == "Warangal"


def test_list_handoffs_includes_ones_the_caller_is_party_to_either_way(client, auth_headers, second_auth_headers, accepted_handoff):
    # auth_headers = traveler, second_auth_headers = requester on accepted_handoff
    traveler_list = client.get("/handoffs", headers=auth_headers).json()
    requester_list = client.get("/handoffs", headers=second_auth_headers).json()
    assert any(h["id"] == accepted_handoff for h in traveler_list)
    assert any(h["id"] == accepted_handoff for h in requester_list)


def test_list_handoffs_excludes_unrelated_ones(client, auth_headers, second_auth_headers, accepted_handoff):
    client.post("/auth/register", json={"name": "Stranger", "email": "stranger2@example.com", "password": "password123"})
    stranger_token = client.post("/auth/login", json={"email": "stranger2@example.com", "password": "password123"}).json()["access_token"]
    res = client.get("/handoffs", headers={"Authorization": f"Bearer {stranger_token}"})
    assert res.json() == []
