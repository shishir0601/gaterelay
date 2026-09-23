def post_trip(client, headers, **overrides):
    payload = {"origin": "Hyderabad", "destination": "Warangal", "departure_time": "2026-10-01T18:00:00Z", "available_capacity": 3}
    payload.update(overrides)
    return client.post("/trips", headers=headers, json=payload).json()


def post_request(client, headers, **overrides):
    payload = {"pickup_location": "Hyderabad", "delivery_location": "Warangal", "earliest_time": "2026-10-01T16:00:00Z", "latest_time": "2026-10-01T20:00:00Z", "item_size": "MEDIUM"}
    payload.update(overrides)
    return client.post("/requests", headers=headers, json=payload).json()


def test_compatible_trip_appears_in_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    res = client.get(f"/matches/{req['id']}", headers=second_auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_wrong_origin_excluded_from_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers, origin="Mumbai", destination="Warangal")
    req = post_request(client, second_auth_headers)
    res = client.get(f"/matches/{req['id']}", headers=second_auth_headers)
    assert res.json() == []


def test_wrong_destination_excluded_from_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers, origin="Hyderabad", destination="Bangalore")
    req = post_request(client, second_auth_headers)
    assert client.get(f"/matches/{req['id']}", headers=second_auth_headers).json() == []


def test_incompatible_time_excluded_from_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers, departure_time="2026-10-05T18:00:00Z")  # request window is Oct 1
    req = post_request(client, second_auth_headers)
    assert client.get(f"/matches/{req['id']}", headers=second_auth_headers).json() == []


def test_insufficient_capacity_excluded_from_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers, available_capacity=1)
    req = post_request(client, second_auth_headers, item_size="LARGE")  # LARGE = 3 units
    assert client.get(f"/matches/{req['id']}", headers=second_auth_headers).json() == []


def test_inactive_trip_excluded_from_matches(client, auth_headers, second_auth_headers):
    trip = post_trip(client, auth_headers)
    client.delete(f"/trips/{trip['id']}", headers=auth_headers)  # only works while ACTIVE, then it's gone entirely
    req = post_request(client, second_auth_headers)
    assert client.get(f"/matches/{req['id']}", headers=second_auth_headers).json() == []


def test_matches_are_sorted_best_first(client, auth_headers, second_auth_headers):
    # Both compatible, but one departs near the edge of the window, one dead-center.
    post_trip(client, auth_headers, departure_time="2026-10-01T16:05:00Z")  # near edge
    post_trip(client, auth_headers, departure_time="2026-10-01T18:00:00Z")  # centered
    req = post_request(client, second_auth_headers)
    matches = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()
    assert len(matches) == 2
    assert matches[0]["score"] >= matches[1]["score"]


def test_match_includes_score_and_reasons(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    match = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]
    assert isinstance(match["score"], int)
    assert len(match["reasons"]) == 3


def test_match_includes_the_traveler_name_not_just_an_id(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)  # posted by "Test User" (the auth_headers fixture's registered name)
    req = post_request(client, second_auth_headers)
    match = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]
    assert match["trip"]["owner_name"] == "Test User"


def test_only_the_request_owner_can_view_its_matches(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    res = client.get(f"/matches/{req['id']}", headers=auth_headers)  # traveler, not the requester
    assert res.status_code == 403


# --- accept ---

def test_valid_acceptance(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    match_id = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]["match_id"]
    res = client.post(f"/matches/{match_id}/accept", headers=second_auth_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["trip"]["status"] == "MATCHED"
    assert body["request"]["status"] == "MATCHED"
    assert body["status"] == "PENDING"


def test_duplicate_acceptance_is_rejected(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    match_id = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]["match_id"]
    first = client.post(f"/matches/{match_id}/accept", headers=second_auth_headers)
    assert first.status_code == 201
    second = client.post(f"/matches/{match_id}/accept", headers=second_auth_headers)
    assert second.status_code == 409


def test_unauthorized_acceptance_by_the_traveler_is_rejected(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    match_id = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]["match_id"]
    res = client.post(f"/matches/{match_id}/accept", headers=auth_headers)  # traveler tries to accept their own trip
    assert res.status_code == 403


def test_unauthorized_acceptance_by_an_unrelated_user_is_rejected(client, auth_headers, second_auth_headers):
    post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    match_id = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()[0]["match_id"]
    third_token_headers = {"Authorization": f"Bearer {_login_third_user(client)}"}
    res = client.post(f"/matches/{match_id}/accept", headers=third_token_headers)
    assert res.status_code == 403


def _login_third_user(client) -> str:
    client.post("/auth/register", json={"name": "Third", "email": "third@example.com", "password": "password123"})
    return client.post("/auth/login", json={"email": "third@example.com", "password": "password123"}).json()["access_token"]


def test_invalid_match_id_format_is_rejected(client, auth_headers):
    res = client.post("/matches/not-a-valid-match-id/accept", headers=auth_headers)
    assert res.status_code == 400


def test_accepting_a_request_that_already_has_a_different_accepted_match_fails(client, auth_headers, second_auth_headers):
    trip1 = post_trip(client, auth_headers)
    trip2 = post_trip(client, auth_headers)
    req = post_request(client, second_auth_headers)
    matches = client.get(f"/matches/{req['id']}", headers=second_auth_headers).json()
    match_id_1 = next(m["match_id"] for m in matches if m["trip"]["id"] == trip1["id"])
    match_id_2 = next(m["match_id"] for m in matches if m["trip"]["id"] == trip2["id"])

    assert client.post(f"/matches/{match_id_1}/accept", headers=second_auth_headers).status_code == 201
    # request is now MATCHED, so accepting a second trip for the same request must fail
    res = client.post(f"/matches/{match_id_2}/accept", headers=second_auth_headers)
    assert res.status_code == 409


def test_accepted_trip_no_longer_appears_in_other_requests_matches(client, auth_headers, second_auth_headers):
    trip = post_trip(client, auth_headers)
    req1 = post_request(client, second_auth_headers)
    match_id = client.get(f"/matches/{req1['id']}", headers=second_auth_headers).json()[0]["match_id"]
    client.post(f"/matches/{match_id}/accept", headers=second_auth_headers)

    req2 = post_request(client, second_auth_headers)  # a second, independent request
    matches_for_req2 = client.get(f"/matches/{req2['id']}", headers=second_auth_headers).json()
    assert all(m["trip"]["id"] != trip["id"] for m in matches_for_req2)
