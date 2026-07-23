const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

process.env.GATERELAY_DB = path.join(__dirname, "test-data.json");
const server = require("../server");

let base;

test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(process.env.GATERELAY_DB, { force: true });
});

// Each test gets a clean slate — trips/requests from one test shouldn't
// bleed into the next just because they share overlapping "now" windows.
test.beforeEach(() => {
  require("../lib/store").save({ members: {}, trips: {}, requests: {}, sessions: {} });
});

/** `token` is optional — omit it to make an unauthenticated call. */
async function api(method, p, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

/** Registers a member and returns their profile + session token together. */
async function checkIn(name, collegeId) {
  const { data } = await api("POST", "/api/members", { name, collegeId });
  return data; // { id, name, collegeId, reputation, createdAt, sessionToken }
}

const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

test("full flow: trip + request auto-match, pickup + delivery codes confirm correctly", async () => {
  const carrier = await checkIn("Rahul", "C001");
  const requester = await checkIn("Priya", "C002");

  const { status: tStatus } = await api(
    "POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 3 }, carrier.sessionToken
  );
  assert.equal(tStatus, 201);

  const { status: rStatus, data: request } = await api(
    "POST", "/api/requests", { description: "Amazon parcel", windowStart: inMin(5), windowEnd: inMin(20) }, requester.sessionToken
  );
  assert.equal(rStatus, 201);
  assert.equal(request.status, "matched"); // auto-matched against the open trip
  assert.ok(request.pickupCode && request.deliveryCode); // visible to the requester who made it

  // Wrong code rejected
  const bad = await api("POST", `/api/requests/${request.id}/confirm-pickup`, { code: "0000" }, carrier.sessionToken);
  assert.equal(bad.status, 400);

  // Correct pickup code — confirmed by the assigned carrier
  const pickup = await api("POST", `/api/requests/${request.id}/confirm-pickup`, { code: request.pickupCode }, carrier.sessionToken);
  assert.equal(pickup.status, 200);
  assert.equal(pickup.data.status, "pickedUp");

  // Correct delivery code — confirmed by the requester -> reputation increases
  const delivery = await api("POST", `/api/requests/${request.id}/confirm-delivery`, { code: request.deliveryCode }, requester.sessionToken);
  assert.equal(delivery.status, 200);
  assert.equal(delivery.data.request.status, "delivered");
  assert.equal(delivery.data.carrierReputation, 104);
});

test("no-show reporting docks carrier reputation", async () => {
  const carrier = await checkIn("Amit", "C010");
  const requester = await checkIn("Sara", "C011");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 2 }, carrier.sessionToken);
  const { data: request } = await api(
    "POST", "/api/requests", { description: "Food", windowStart: inMin(0), windowEnd: inMin(15) }, requester.sessionToken
  );
  assert.equal(request.status, "matched");

  const reported = await api("POST", `/api/requests/${request.id}/report-no-show`, {}, requester.sessionToken);
  assert.equal(reported.status, 200);
  assert.equal(reported.data.carrierReputation, 80); // 100 - 20
});

test("high-value request is not matched to a low-reputation carrier", async () => {
  const carrier = await checkIn("Newbie", "C020");
  // Manually drag reputation down to simulate low trust
  const db = require("../lib/store").load();
  db.members[carrier.id].reputation = 60;
  require("../lib/store").save(db);

  const requester = await checkIn("Vik", "C021");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 3 }, carrier.sessionToken);
  const { data: request } = await api(
    "POST", "/api/requests",
    { description: "Laptop", valueTag: "high", windowStart: inMin(0), windowEnd: inMin(15) },
    requester.sessionToken
  );
  assert.equal(request.status, "pending"); // NOT matched — carrier reputation too low for high-value
});

test("capacity is respected: extra requests stay pending", async () => {
  const carrier = await checkIn("Kabir", "C030");
  const r1 = await checkIn("R1", "C031");
  const r2 = await checkIn("R2", "C032");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 1 }, carrier.sessionToken);

  const { data: req1 } = await api("POST", "/api/requests", { description: "A", windowStart: inMin(0), windowEnd: inMin(10) }, r1.sessionToken);
  const { data: req2 } = await api("POST", "/api/requests", { description: "B", windowStart: inMin(0), windowEnd: inMin(10) }, r2.sessionToken);
  assert.equal(req1.status, "matched");
  assert.equal(req2.status, "pending"); // capacity 1, already full
});

test("validation: rejects bad trip and request bodies", async () => {
  const member = await checkIn("X", "C040");
  const badTrip = await api("POST", "/api/trips", { windowStart: inMin(10), windowEnd: inMin(0), capacity: 1 }, member.sessionToken);
  assert.equal(badTrip.status, 400);
  const badReq = await api("POST", "/api/requests", { description: "", windowStart: inMin(0), windowEnd: inMin(10) }, member.sessionToken);
  assert.equal(badReq.status, 400);
});

test("validation: protected routes require a valid session", async () => {
  const noAuth = await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 1 });
  assert.equal(noAuth.status, 401);
  const badToken = await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 1 }, "not-a-real-token");
  assert.equal(badToken.status, 401);
});

test("a carrier is never auto-matched to their own request", async () => {
  const alice = await checkIn("Alice", "C050");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 3 }, alice.sessionToken);
  const { data: ownRequest } = await api(
    "POST", "/api/requests", { description: "My own parcel", windowStart: inMin(0), windowEnd: inMin(10) }, alice.sessionToken
  );
  assert.equal(ownRequest.status, "pending"); // must NOT be matched to her own trip

  // But someone else's overlapping request on the same trip should match fine.
  const bob = await checkIn("Bob", "C051");
  const { data: bobsRequest } = await api(
    "POST", "/api/requests", { description: "Bob's parcel", windowStart: inMin(0), windowEnd: inMin(10) }, bob.sessionToken
  );
  assert.equal(bobsRequest.status, "matched");
});

test("requesters can cancel a pending request; matched requests cannot be cancelled by anyone", async () => {
  const requester = await checkIn("Nadia", "C060");
  const { data: pending } = await api(
    "POST", "/api/requests", { description: "Textbook", windowStart: inMin(0), windowEnd: inMin(30) }, requester.sessionToken
  );
  assert.equal(pending.status, "pending");

  const cancelled = await api("POST", `/api/requests/${pending.id}/cancel`, {}, requester.sessionToken);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, "cancelled");

  const carrier = await checkIn("Owen", "C061");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 2 }, carrier.sessionToken);
  const { data: matchedReq } = await api(
    "POST", "/api/requests", { description: "Snacks", windowStart: inMin(0), windowEnd: inMin(15) }, requester.sessionToken
  );
  assert.equal(matchedReq.status, "matched");

  const forbidden = await api("POST", `/api/requests/${matchedReq.id}/cancel`, {}, carrier.sessionToken);
  assert.equal(forbidden.status, 403); // not the requester

  const tooLate = await api("POST", `/api/requests/${matchedReq.id}/cancel`, {}, requester.sessionToken);
  assert.equal(tooLate.status, 400); // already matched, no longer pending
});

test("carriers can close their own open trip; nobody else can, and closed trips stop matching", async () => {
  const carrier = await checkIn("Meera", "C070");
  const { data: trip } = await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 2 }, carrier.sessionToken);

  const stranger = await checkIn("Zed", "C071");
  const forbidden = await api("POST", `/api/trips/${trip.id}/close`, {}, stranger.sessionToken);
  assert.equal(forbidden.status, 403);

  const closed = await api("POST", `/api/trips/${trip.id}/close`, {}, carrier.sessionToken);
  assert.equal(closed.status, 200);
  assert.equal(closed.data.status, "closed");

  const alreadyClosed = await api("POST", `/api/trips/${trip.id}/close`, {}, carrier.sessionToken);
  assert.equal(alreadyClosed.status, 400);

  // a closed trip no longer accepts new matches
  const requester = await checkIn("Priyanka", "C072");
  const { data: request } = await api(
    "POST", "/api/requests", { description: "Mail", windowStart: inMin(0), windowEnd: inMin(15) }, requester.sessionToken
  );
  assert.equal(request.status, "pending");
});

test("handoff codes are only visible to the request's own requester", async () => {
  const requester = await checkIn("Ishaan", "C080");
  const carrier = await checkIn("Farah", "C081");
  await api("POST", "/api/trips", { windowStart: inMin(0), windowEnd: inMin(30), capacity: 2 }, carrier.sessionToken);
  const { data: created } = await api(
    "POST", "/api/requests", { description: "Charger", windowStart: inMin(0), windowEnd: inMin(15) }, requester.sessionToken
  );
  assert.ok(created.pickupCode && created.deliveryCode);

  const asCarrier = await api("GET", "/api/requests", undefined, carrier.sessionToken);
  const seenByCarrier = asCarrier.data.find((r) => r.id === created.id);
  assert.equal(seenByCarrier.pickupCode, null);
  assert.equal(seenByCarrier.deliveryCode, null);

  const asRequester = await api("GET", "/api/requests", undefined, requester.sessionToken);
  const seenByRequester = asRequester.data.find((r) => r.id === created.id);
  assert.equal(seenByRequester.pickupCode, created.pickupCode);
  assert.equal(seenByRequester.deliveryCode, created.deliveryCode);
});

test("GET /api/health reports ok without requiring a session", async () => {
  const res = await api("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
});

test("registering with an existing collegeId returns the same member but a fresh session", async () => {
  const first = await checkIn("Dev", "C090");
  const second = await checkIn("Dev", "C090");
  assert.equal(first.id, second.id);
  assert.notEqual(first.sessionToken, second.sessionToken);
});
