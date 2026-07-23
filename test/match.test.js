const test = require("node:test");
const assert = require("node:assert/strict");
const {
  overlaps,
  effectiveCapacity,
  matchTrip,
  applyReputationEvent,
} = require("../lib/match");

const T = (mins) => mins * 60_000; // minutes -> ms, for readable windows

// Every request defaults to a requester distinct from the default trip
// carrier ("the-carrier") so tests aren't accidentally exercising the
// self-match exclusion unless they mean to.
function req(id, windowStart, windowEnd, valueTag = "low", requesterId = `requester-${id}`) {
  return { id, status: "pending", windowStart, windowEnd, valueTag, requesterId };
}

function trip(overrides) {
  return { carrierId: "the-carrier", carrierReputation: 100, ...overrides };
}

test("overlaps: detects genuine overlap and rejects disjoint windows", () => {
  assert.equal(overlaps(0, T(10), T(5), T(15)), true);
  assert.equal(overlaps(0, T(10), T(10), T(20)), true); // touching endpoints count
  assert.equal(overlaps(0, T(10), T(11), T(20)), false);
});

test("effectiveCapacity: low-reputation carriers capped at 1 regardless of stated capacity", () => {
  assert.equal(effectiveCapacity({ capacity: 5 }, 40), 1);
  assert.equal(effectiveCapacity({ capacity: 5 }, 60), 5);
  assert.equal(effectiveCapacity({ capacity: 0 }, 100), 0);
});

test("matchTrip: only assigns requests whose window overlaps the trip", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(10), capacity: 5 });
  const requests = [req("a", T(0), T(5)), req("b", T(20), T(30))];
  const matched = matchTrip(t, requests);
  assert.deepEqual(matched.map((r) => r.id), ["a"]);
});

test("matchTrip: respects capacity, prioritizing earliest deadline first", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(60), capacity: 2 });
  const requests = [
    req("late", T(0), T(50)),
    req("urgent", T(0), T(10)),
    req("mid", T(0), T(30)),
  ];
  const matched = matchTrip(t, requests);
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((r) => r.id), ["urgent", "mid"]); // EDF order
});

test("matchTrip: high-value requests excluded for low-reputation carriers", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(60), capacity: 5, carrierReputation: 60 });
  const requests = [req("valuable", T(0), T(10), "high"), req("normal", T(0), T(10), "low")];
  const matched = matchTrip(t, requests);
  assert.deepEqual(matched.map((r) => r.id), ["normal"]);
});

test("matchTrip: high-value requests allowed for trusted carriers", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(60), capacity: 5, carrierReputation: 90 });
  const requests = [req("valuable", T(0), T(10), "high")];
  const matched = matchTrip(t, requests);
  assert.deepEqual(matched.map((r) => r.id), ["valuable"]);
});

test("matchTrip: ignores requests that are not pending", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(60), capacity: 5 });
  const requests = [{ ...req("done", T(0), T(10)), status: "delivered" }];
  assert.deepEqual(matchTrip(t, requests), []);
});

test("matchTrip: low reputation caps capacity to 1 even with room for more", () => {
  const t = trip({ windowStart: T(0), windowEnd: T(60), capacity: 5, carrierReputation: 30 });
  const requests = [req("a", T(0), T(10)), req("b", T(0), T(20))];
  const matched = matchTrip(t, requests);
  assert.equal(matched.length, 1);
});

test("matchTrip: a carrier cannot be matched to their own request", () => {
  const t = trip({ carrierId: "alice", windowStart: T(0), windowEnd: T(60), capacity: 5 });
  const requests = [
    req("own-parcel", T(0), T(10), "low", "alice"),
    req("someone-elses", T(0), T(10), "low", "bob"),
  ];
  const matched = matchTrip(t, requests);
  assert.deepEqual(matched.map((r) => r.id), ["someone-elses"]);
});

test("reputation: completed handoff increases score, clamped at 150", () => {
  assert.equal(applyReputationEvent(100, "COMPLETED"), 104);
  assert.equal(applyReputationEvent(149, "COMPLETED"), 150);
});

test("reputation: no-show and upheld dispute penalize, clamped at 0", () => {
  assert.equal(applyReputationEvent(100, "NO_SHOW"), 80);
  assert.equal(applyReputationEvent(100, "DISPUTE_UPHELD"), 70);
  assert.equal(applyReputationEvent(10, "DISPUTE_UPHELD"), 0);
});

test("reputation: unknown event throws rather than silently no-op", () => {
  assert.throws(() => applyReputationEvent(100, "MADE_UP"));
});
