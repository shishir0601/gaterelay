def test_successful_registration(client):
    res = client.post("/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": "password123"})
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "alice@example.com"
    assert "password" not in body
    assert "password_hash" not in body


def test_duplicate_email_registration_rejected(client):
    client.post("/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": "password123"})
    res = client.post("/auth/register", json={"name": "Alice Two", "email": "alice@example.com", "password": "password456"})
    assert res.status_code == 409


def test_successful_login(client):
    client.post("/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": "password123"})
    res = client.post("/auth/login", json={"email": "alice@example.com", "password": "password123"})
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_login_with_incorrect_password(client):
    client.post("/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": "password123"})
    res = client.post("/auth/login", json={"email": "alice@example.com", "password": "wrongpassword"})
    assert res.status_code == 401


def test_login_with_unknown_email(client):
    res = client.post("/auth/login", json={"email": "nobody@example.com", "password": "password123"})
    assert res.status_code == 401


def test_protected_endpoint_without_token(client):
    res = client.get("/auth/me")
    assert res.status_code == 401


def test_protected_endpoint_with_invalid_token(client):
    res = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert res.status_code == 401


def test_protected_endpoint_with_expired_token(client):
    # A genuine coverage gap found during review: JWTs here do carry a real expiry
    # (auth.ACCESS_TOKEN_EXPIRE_MINUTES), but nothing actually proved an expired one gets
    # rejected rather than silently accepted.
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from auth import SECRET_KEY, ALGORITHM

    expired_payload = {"sub": "some-user-id", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}
    expired_token = jwt.encode(expired_payload, SECRET_KEY, algorithm=ALGORITHM)
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert res.status_code == 401


def test_me_returns_the_authenticated_user(client, auth_headers):
    res = client.get("/auth/me", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["email"] == "user@example.com"


def test_password_is_actually_hashed_not_stored_plaintext(client, db_engine):
    client.post("/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": "password123"})
    from sqlalchemy.orm import sessionmaker
    from models import User

    Session = sessionmaker(bind=db_engine)
    db = Session()
    user = db.query(User).filter(User.email == "alice@example.com").first()
    assert user.password_hash != "password123"
    assert user.password_hash.startswith("$2b$")  # bcrypt's own format prefix
    db.close()


def test_deleting_a_user_cascades_to_their_trips_requests_and_handoffs(client, db_engine, second_auth_headers):
    # Every foreign key in models.py declares ON DELETE CASCADE, but that was never
    # actually verified -- a declared constraint that doesn't behave as claimed is exactly
    # the kind of thing this audit is supposed to catch, not assume. There's no DELETE
    # /auth/me endpoint (out of scope), so this exercises the constraint directly at the
    # database level, which is the actual thing being claimed.
    from sqlalchemy.orm import sessionmaker
    db = sessionmaker(bind=db_engine)()

    reg = client.post("/auth/register", json={"name": "Doomed", "email": "doomed@example.com", "password": "password123"})
    token = client.post("/auth/login", json={"email": "doomed@example.com", "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    trip = client.post("/trips", headers=headers, json={"origin": "Hyderabad", "destination": "Warangal", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3}).json()
    own_request = client.post("/requests", headers=headers, json={"pickup_location": "A", "delivery_location": "B", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "SMALL"}).json()

    # Also have this user act as the REQUESTER on a trip owned by someone else, so a
    # Handoff row referencing them exists too, exercising the Handoff FKs.
    other_trip = client.post("/trips", headers=second_auth_headers, json={"origin": "Delhi", "destination": "Pune", "departure_time": "2026-11-01T18:00:00Z", "available_capacity": 3}).json()
    matching_request = client.post("/requests", headers=headers, json={"pickup_location": "Delhi", "delivery_location": "Pune", "earliest_time": "2026-11-01T16:00:00Z", "latest_time": "2026-11-01T20:00:00Z", "item_size": "SMALL"}).json()
    match_id = client.get(f"/matches/{matching_request['id']}", headers=headers).json()[0]["match_id"]
    accept = client.post(f"/matches/{match_id}/accept", headers=headers).json()

    from models import User as UserModel, Trip as TripModel, Request as RequestModel, Handoff as HandoffModel

    user_id = reg.json()["id"]
    assert db.query(TripModel).filter(TripModel.id == trip["id"]).first() is not None
    assert db.query(RequestModel).filter(RequestModel.id == own_request["id"]).first() is not None
    assert db.query(HandoffModel).filter(HandoffModel.id == accept["handoff_id"]).first() is not None

    db_user = db.query(UserModel).filter(UserModel.id == user_id).first()
    db.delete(db_user)
    db.commit()

    assert db.query(TripModel).filter(TripModel.id == trip["id"]).first() is None
    assert db.query(RequestModel).filter(RequestModel.id == own_request["id"]).first() is None
    assert db.query(RequestModel).filter(RequestModel.id == matching_request["id"]).first() is None
    assert db.query(HandoffModel).filter(HandoffModel.id == accept["handoff_id"]).first() is None
    db.close()
