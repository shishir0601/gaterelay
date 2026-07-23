"use strict";

const crypto = require("crypto");
const store = require("../../lib/store");
const { serializeMember } = require("../serializers");
const { trimmedString, MAX_NAME_LENGTH, MAX_COLLEGE_ID_LENGTH } = require("../validation");
const { createSessionToken } = require("../http/session");

/** Register (or re-check-in) by college ID. Always issues a fresh session token. */
function checkIn({ db, body }) {
  const name = trimmedString(body.name);
  const collegeId = trimmedString(body.collegeId);

  if (!name || !collegeId) {
    return { status: 400, body: { error: "name and collegeId are required" } };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { status: 400, body: { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` } };
  }
  if (collegeId.length > MAX_COLLEGE_ID_LENGTH) {
    return { status: 400, body: { error: `collegeId must be ${MAX_COLLEGE_ID_LENGTH} characters or fewer` } };
  }

  let member = Object.values(db.members).find((m) => m.collegeId === collegeId);
  let status = 200;
  if (!member) {
    member = { id: crypto.randomUUID(), name, collegeId, reputation: 100, createdAt: Date.now() };
    db.members[member.id] = member;
    status = 201;
  }

  const token = createSessionToken();
  db.sessions[token] = { memberId: member.id, createdAt: Date.now() };
  store.save(db);

  return { status, body: { ...serializeMember(member), sessionToken: token } };
}

function getById({ db, params }) {
  const member = db.members[params[0]];
  if (!member) return { status: 404, body: { error: "Member not found" } };
  return { status: 200, body: serializeMember(member) };
}

module.exports = { checkIn, getById };
