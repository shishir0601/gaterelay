"use strict";

const crypto = require("crypto");

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Resolves the `Authorization: Bearer <token>` header against `db.sessions`.
 * Returns `{ token, memberId, member }` or `null` — never throws, so
 * callers can treat "no session" and "bad session" the same way (both
 * just mean unauthenticated).
 *
 * Sessions never expire in this project — there's no TTL/refresh flow.
 * That's a deliberate scope cut for a single-server student project, not
 * an oversight; see README roadmap.
 */
function resolveSession(req, db) {
  const header = req.headers["authorization"] || "";
  const match = BEARER_PATTERN.exec(header.trim());
  if (!match) return null;

  const token = match[1];
  const session = db.sessions[token];
  if (!session) return null;

  const member = db.members[session.memberId];
  if (!member) return null;

  return { token, memberId: member.id, member };
}

module.exports = { createSessionToken, resolveSession };
