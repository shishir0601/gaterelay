EARLIEST = "2026-10-01T17:00:00Z"
LATEST = "2026-10-01T20:00:00Z"


def create_request(client, headers, pickup="Hyderabad", delivery="Warangal", size="MEDIUM"):
    return client.post(
        "/requests",
        headers=headers,
        json={"pickup_location": pickup, "delivery_location": delivery, "earliest_time": EARLIEST, "latest_time": LATEST, "item_size": size},
    )


def test_create_request(client, auth_headers):
    res = create_request(client, auth_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["item_size"] == 2  # MEDIUM -> 2 capacity units
    assert body["status"] == "OPEN"


def test_create_request_requires_auth(client):
    res = client.post("/requests", json={"pickup_location": "A", "delivery_location": "B", "earliest_time": EARLIEST, "latest_time": LATEST, "item_size": "SMALL"})
    assert res.status_code == 401


def test_create_request_rejects_invalid_item_size(client, auth_headers):
    res = create_request(client, auth_headers, size="HUGE")
    assert res.status_code == 422


def test_create_request_rejects_latest_before_earliest(client, auth_headers):
    res = client.post(
        "/requests",
        headers=auth_headers,
        json={"pickup_location": "A", "delivery_location": "B", "earliest_time": LATEST, "latest_time": EARLIEST, "item_size": "SMALL"},
    )
    assert res.status_code == 422


def test_retrieve_request(client, auth_headers):
    created = create_request(client, auth_headers).json()
    res = client.get(f"/requests/{created['id']}", headers=auth_headers)
    assert res.status_code == 200


def test_retrieve_nonexistent_request(client, auth_headers):
    res = client.get("/requests/does-not-exist", headers=auth_headers)
    assert res.status_code == 404


def test_list_requests_only_returns_own_requests(client, auth_headers, second_auth_headers):
    create_request(client, auth_headers)
    create_request(client, second_auth_headers)
    res = client.get("/requests", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_delete_request(client, auth_headers):
    created = create_request(client, auth_headers).json()
    res = client.delete(f"/requests/{created['id']}", headers=auth_headers)
    assert res.status_code == 204


def test_ownership_protection(client, auth_headers, second_auth_headers):
    created = create_request(client, auth_headers).json()
    assert client.get(f"/requests/{created['id']}", headers=second_auth_headers).status_code == 403
    assert client.delete(f"/requests/{created['id']}", headers=second_auth_headers).status_code == 403
