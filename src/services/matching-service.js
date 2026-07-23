"use strict";

const match = require("../../lib/match");
const { generateHandoffCodes } = require("./codes");

/** Mutates `request` and `trip` in place to record a match; caller persists. */
function assignRequestToTrip(request, trip) {
  const { pickupCode, deliveryCode } = generateHandoffCodes();
  request.status = "matched";
  request.tripId = trip.id;
  request.pickupCode = pickupCode;
  request.deliveryCode = deliveryCode;
  trip.matchedRequestIds.push(request.id);
}

/** New trip just posted — pull in whatever pending requests it can carry, EDF-ordered. */
function matchNewTrip(db, trip, carrier) {
  const pending = Object.values(db.requests).filter((r) => r.status === "pending");
  const tripForMatching = { ...trip, carrierReputation: carrier.reputation };
  const winners = match.matchTrip(tripForMatching, pending);
  for (const request of winners) {
    assignRequestToTrip(db.requests[request.id], db.trips[trip.id]);
  }
}

/** New request just posted — offer it to open trips, soonest-departing first. */
function matchNewRequest(db, request) {
  const openTrips = Object.values(db.trips)
    .filter((t) => t.status === "open")
    .sort((a, b) => a.windowEnd - b.windowEnd);

  for (const trip of openTrips) {
    const carrier = db.members[trip.carrierId];
    if (!carrier) continue;
    const tripForMatching = { ...trip, carrierReputation: carrier.reputation };
    const remaining = match.effectiveCapacity(tripForMatching, carrier.reputation) - trip.matchedRequestIds.length;
    if (remaining <= 0) continue;
    if (match.isEligible(tripForMatching, request)) {
      assignRequestToTrip(request, trip);
      break;
    }
  }
}

module.exports = { assignRequestToTrip, matchNewTrip, matchNewRequest };
