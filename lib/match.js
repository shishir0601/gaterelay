"use strict";

/**
 * Pure, dependency-free matching + reputation logic.
 * Nothing in this file touches the filesystem, the network, or Date.now() —
 * that's what makes it trivial to unit test (see test/match.test.js).
 */

const LOW_REPUTATION_CAPACITY_CAP = 1;
const LOW_REPUTATION_THRESHOLD = 50;
const HIGH_VALUE_REPUTATION_THRESHOLD = 80;

const REPUTATION_EVENTS = {
  COMPLETED: 4,
  NO_SHOW: -20,
  DISPUTE_UPHELD: -30,
};

const REPUTATION_MIN = 0;
const REPUTATION_MAX = 150;

/**
 * Do two closed intervals [startA, endA] and [startB, endB] overlap?
 * Touching endpoints count as an overlap (a trip ending exactly when a
 * request's window opens is still a valid handoff moment).
 */
function overlaps(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

/**
 * A carrier's stated capacity is capped when their reputation is low —
 * a new or previously-unreliable carrier shouldn't be handed a stack of
 * parcels on trust alone.
 */
function effectiveCapacity(trip, reputation) {
  if (reputation < LOW_REPUTATION_THRESHOLD) {
    return Math.min(trip.capacity, LOW_REPUTATION_CAPACITY_CAP);
  }
  return trip.capacity;
}

/**
 * Can this single request ever ride this trip, ignoring capacity?
 * (overlap, self-match exclusion, value-gating). Capacity is handled
 * separately by matchTrip / by the server when a trip already has some
 * requests assigned to it.
 */
function isEligible(trip, request) {
  if (request.status !== "pending") return false;
  if (request.requesterId === trip.carrierId) return false;
  if (!overlaps(trip.windowStart, trip.windowEnd, request.windowStart, request.windowEnd)) {
    return false;
  }
  if (request.valueTag === "high" && trip.carrierReputation < HIGH_VALUE_REPUTATION_THRESHOLD) {
    return false;
  }
  return true;
}

/**
 * Given a trip and a pool of candidate requests, pick which ones it should
 * carry: everyone eligible, Earliest-Deadline-First, capped by the
 * carrier's effective capacity. `trip.carrierReputation` must be supplied
 * by the caller (the server looks this up live from the members store).
 */
function matchTrip(trip, requests) {
  const eligible = requests.filter((request) => isEligible(trip, request));
  eligible.sort((a, b) => a.windowEnd - b.windowEnd);
  const capacity = Math.max(effectiveCapacity(trip, trip.carrierReputation), 0);
  return eligible.slice(0, capacity);
}

/**
 * Apply a reputation event, clamped to [0, 150]. Throws on an unrecognized
 * event type rather than silently no-op'ing, so a typo'd event name fails
 * loudly instead of quietly losing a reputation update.
 */
function applyReputationEvent(reputation, eventType) {
  if (!Object.prototype.hasOwnProperty.call(REPUTATION_EVENTS, eventType)) {
    throw new Error(`Unknown reputation event: ${eventType}`);
  }
  const next = reputation + REPUTATION_EVENTS[eventType];
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, next));
}

module.exports = {
  overlaps,
  effectiveCapacity,
  isEligible,
  matchTrip,
  applyReputationEvent,
};
