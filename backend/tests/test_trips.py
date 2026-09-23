FUTURE_TIME = "2026-10-01T18:00:00Z"


def create_trip(client, headers, origin="Hyderabad", destination="Warangal", capacity=3, departure=FUTURE_TIME):
    return client.post(
        "/trips",
        headers=headers,
        json={"origin": origin, "destination": destination, "departure_time": departure, "available_capacity": capacity},
    )


def test_create_trip(client, auth_headers):
    res = create_trip(client, auth_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["origin"] == "Hyderabad"
    assert body["status"] == "ACTIVE"


def test_create_trip_requires_auth(client):
    res = client.post("/trips", json={"origin": "A", "destination": "B", "departure_time": FUTURE_TIME, "available_capacity": 1})
    assert res.status_code == 401


def test_create_trip_rejects_same_origin_and_destination(client, auth_headers):
    res = create_trip(client, auth_headers, origin="Hyderabad", destination="hyderabad")
    assert res.status_code == 422


def test_create_trip_rejects_zero_capacity(client, auth_headers):
    res = create_trip(client, auth_headers, capacity=0)
    assert res.status_code == 422


def test_create_trip_rejects_capacity_over_the_maximum(client, auth_headers):
    res = create_trip(client, auth_headers, capacity=11)  # max is 10 -- see TripCreate.available_capacity
    assert res.status_code == 422


def test_create_trip_rejects_negative_capacity(client, auth_headers):
    res = create_trip(client, auth_headers, capacity=-1)
    assert res.status_code == 422


def test_retrieve_trip(client, auth_headers):
    created = create_trip(client, auth_headers).json()
    res = client.get(f"/trips/{created['id']}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["id"] == created["id"]


def test_retrieve_nonexistent_trip(client, auth_headers):
    res = client.get("/trips/does-not-exist", headers=auth_headers)
    assert res.status_code == 404


def test_delete_trip(client, auth_headers):
    created = create_trip(client, auth_headers).json()
    res = client.delete(f"/trips/{created['id']}", headers=auth_headers)
    assert res.status_code == 204
    assert client.get(f"/trips/{created['id']}", headers=auth_headers).status_code == 404


def test_ownership_protection_on_get(client, auth_headers, second_auth_headers):
    created = create_trip(client, auth_headers).json()
    res = client.get(f"/trips/{created['id']}", headers=second_auth_headers)
    assert res.status_code == 403


def test_ownership_protection_on_delete(client, auth_headers, second_auth_headers):
    created = create_trip(client, auth_headers).json()
    res = client.delete(f"/trips/{created['id']}", headers=second_auth_headers)
    assert res.status_code == 403
    # and it genuinely wasn't deleted
    assert client.get(f"/trips/{created['id']}", headers=auth_headers).status_code == 200


def test_list_trips_only_returns_own_trips(client, auth_headers, second_auth_headers):
    create_trip(client, auth_headers)
    create_trip(client, second_auth_headers)
    res = client.get("/trips", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1
