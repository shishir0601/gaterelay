"use strict";

function serializeMember(member) {
  return {
    id: member.id,
    name: member.name,
    collegeId: member.collegeId,
    reputation: member.reputation,
    createdAt: member.createdAt,
  };
}

function serializeTrip(trip) {
  return {
    id: trip.id,
    carrierId: trip.carrierId,
    direction: trip.direction,
    windowStart: trip.windowStart,
    windowEnd: trip.windowEnd,
    capacity: trip.capacity,
    matchedRequestIds: trip.matchedRequestIds,
    status: trip.status,
    createdAt: trip.createdAt,
  };
}

/**
 * Handoff codes are only meaningful to the person who made the request —
 * the carrier learns them by having the code shown in person, not by
 * reading the API. `viewerId` is the authenticated caller; anyone other
 * than the request's own requester gets the codes redacted.
 */
function serializeRequest(request, viewerId) {
  const isOwner = Boolean(viewerId) && viewerId === request.requesterId;
  return {
    id: request.id,
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    description: request.description,
    type: request.type,
    valueTag: request.valueTag,
    windowStart: request.windowStart,
    windowEnd: request.windowEnd,
    status: request.status,
    tripId: request.tripId,
    pickupCode: isOwner ? request.pickupCode : null,
    deliveryCode: isOwner ? request.deliveryCode : null,
    createdAt: request.createdAt,
  };
}

module.exports = { serializeMember, serializeTrip, serializeRequest };
