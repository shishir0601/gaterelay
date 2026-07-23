"use strict";

const crypto = require("crypto");
const store = require("../../lib/store");
const match = require("../../lib/match");
const { serializeRequest } = require("../serializers");
const { trimmedString, parseTimestamp, validateWindow, MAX_DESCRIPTION_LENGTH } = require("../validation");
const { matchNewRequest } = require("../services/matching-service");

const VALID_TYPES = new Set(["parcel", "food"]);
const VALID_VALUE_TAGS = new Set(["low", "high"]);

function create({ db, auth, body }) {
  const requester = auth.member;

  const description = trimmedString(body.description);
  if (!description) return { status: 400, body: { error: "description is required" } };
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { status: 400, body: { error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` } };
  }

  const type = VALID_TYPES.has(body.type) ? body.type : "parcel";
  const valueTag = VALID_VALUE_TAGS.has(body.valueTag) ? body.valueTag : "low";
  const windowStart = parseTimestamp(body.windowStart);
  const windowEnd = parseTimestamp(body.windowEnd);

  const windowError = validateWindow(windowStart, windowEnd);
  if (windowError) return { status: 400, body: { error: windowError } };

  const request = {
    id: crypto.randomUUID(),
    requesterId: requester.id,
    requesterName: requester.name,
    description,
    type,
    valueTag,
    windowStart,
    windowEnd,
    status: "pending",
    tripId: null,
    pickupCode: null,
    deliveryCode: null,
    createdAt: Date.now(),
  };
  db.requests[request.id] = request;

  matchNewRequest(db, request);

  store.save(db);
  return { status: 201, body: serializeRequest(request, requester.id) };
}

function list({ db, auth }) {
  const viewerId = auth ? auth.memberId : null;
  const requests = Object.values(db.requests)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => serializeRequest(r, viewerId));
  return { status: 200, body: requests };
}

function cancel({ db, auth, params }) {
  const request = db.requests[params[0]];
  if (!request) return { status: 404, body: { error: "Request not found" } };
  if (request.requesterId !== auth.memberId) {
    return { status: 403, body: { error: "Only the requester can cancel this request" } };
  }
  if (request.status !== "pending") {
    return { status: 400, body: { error: "Only a pending request can be cancelled" } };
  }
  request.status = "cancelled";
  store.save(db);
  return { status: 200, body: serializeRequest(request, auth.memberId) };
}

function confirmPickup({ db, auth, params, body }) {
  const request = db.requests[params[0]];
  if (!request) return { status: 404, body: { error: "Request not found" } };

  const trip = db.trips[request.tripId];
  if (!trip || trip.carrierId !== auth.memberId) {
    return { status: 403, body: { error: "Only the assigned carrier can confirm pickup" } };
  }
  if (request.status !== "matched") {
    return { status: 400, body: { error: "Request is not awaiting pickup" } };
  }
  const code = trimmedString(body.code);
  if (code !== request.pickupCode) {
    return { status: 400, body: { error: "Incorrect pickup code" } };
  }
  request.status = "pickedUp";
  store.save(db);
  return { status: 200, body: serializeRequest(request, auth.memberId) };
}

function confirmDelivery({ db, auth, params, body }) {
  const request = db.requests[params[0]];
  if (!request) return { status: 404, body: { error: "Request not found" } };
  if (request.requesterId !== auth.memberId) {
    return { status: 403, body: { error: "Only the requester can confirm delivery" } };
  }
  if (request.status !== "pickedUp") {
    return { status: 400, body: { error: "Request has not been picked up yet" } };
  }
  const code = trimmedString(body.code);
  if (code !== request.deliveryCode) {
    return { status: 400, body: { error: "Incorrect delivery code" } };
  }
  request.status = "delivered";

  const trip = db.trips[request.tripId];
  const carrier = trip ? db.members[trip.carrierId] : null;
  if (carrier) {
    carrier.reputation = match.applyReputationEvent(carrier.reputation, "COMPLETED");
  }

  store.save(db);
  return {
    status: 200,
    body: { request: serializeRequest(request, auth.memberId), carrierReputation: carrier ? carrier.reputation : null },
  };
}

function reportNoShow({ db, auth, params }) {
  const request = db.requests[params[0]];
  if (!request) return { status: 404, body: { error: "Request not found" } };
  if (request.requesterId !== auth.memberId) {
    return { status: 403, body: { error: "Only the requester can report a no-show" } };
  }
  if (request.status !== "matched") {
    return { status: 400, body: { error: "Only a matched, not-yet-picked-up request can be reported as a no-show" } };
  }

  const trip = db.trips[request.tripId];
  const carrier = trip ? db.members[trip.carrierId] : null;
  if (carrier) {
    carrier.reputation = match.applyReputationEvent(carrier.reputation, "NO_SHOW");
  }
  request.status = "disputed";
  if (trip) {
    trip.matchedRequestIds = trip.matchedRequestIds.filter((id) => id !== request.id);
  }

  store.save(db);
  return {
    status: 200,
    body: { request: serializeRequest(request, auth.memberId), carrierReputation: carrier ? carrier.reputation : null },
  };
}

module.exports = { create, list, cancel, confirmPickup, confirmDelivery, reportNoShow };
