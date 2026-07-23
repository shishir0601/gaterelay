"use strict";

const crypto = require("crypto");
const store = require("../../lib/store");
const { serializeTrip } = require("../serializers");
const { parseTimestamp, validateWindow, MAX_CAPACITY } = require("../validation");
const { matchNewTrip } = require("../services/matching-service");

const VALID_DIRECTIONS = new Set(["toGate", "fromGate"]);

function create({ db, auth, body }) {
  const carrier = auth.member; // router guarantees auth is present for non-public routes

  const direction = VALID_DIRECTIONS.has(body.direction) ? body.direction : "toGate";
  const windowStart = parseTimestamp(body.windowStart);
  const windowEnd = parseTimestamp(body.windowEnd);
  const capacity = Number(body.capacity);

  const windowError = validateWindow(windowStart, windowEnd);
  if (windowError) return { status: 400, body: { error: windowError } };
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { status: 400, body: { error: "capacity must be a whole number of at least 1" } };
  }
  if (capacity > MAX_CAPACITY) {
    return { status: 400, body: { error: `capacity cannot exceed ${MAX_CAPACITY}` } };
  }

  const trip = {
    id: crypto.randomUUID(),
    carrierId: carrier.id,
    direction,
    windowStart,
    windowEnd,
    capacity,
    matchedRequestIds: [],
    status: "open",
    createdAt: Date.now(),
  };
  db.trips[trip.id] = trip;

  matchNewTrip(db, trip, carrier);

  store.save(db);
  return { status: 201, body: serializeTrip(trip) };
}

function list({ db }) {
  const trips = Object.values(db.trips)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(serializeTrip);
  return { status: 200, body: trips };
}

function close({ db, auth, params }) {
  const trip = db.trips[params[0]];
  if (!trip) return { status: 404, body: { error: "Trip not found" } };
  if (trip.carrierId !== auth.memberId) {
    return { status: 403, body: { error: "Only the carrier can close this trip" } };
  }
  if (trip.status !== "open") {
    return { status: 400, body: { error: "Trip is already closed" } };
  }
  trip.status = "closed";
  store.save(db);
  return { status: 200, body: serializeTrip(trip) };
}

module.exports = { create, list, close };
