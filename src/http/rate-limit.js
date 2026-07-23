"use strict";

const { createRateLimiter } = require("../../lib/rate-limiter");

const LIMIT = Number(process.env.GATERELAY_RATE_LIMIT) || 200;
const WINDOW_MS = Number(process.env.GATERELAY_RATE_WINDOW_MS) || 60_000;
const limiter = createRateLimiter({ limit: LIMIT, windowMs: WINDOW_MS });

// Only the routes that create new board entries are limited — confirming a
// handoff or reporting a no-show is a low-frequency, human-driven action
// that shouldn't be throttled the same way as automatable "create" spam.
const LIMITED_ROUTES = new Set(["POST /api/members", "POST /api/trips", "POST /api/requests"]);

/** Returns a 429 response object if the caller is over the limit for this route, else null. */
function checkRateLimit(req, pathname, method) {
  if (!LIMITED_ROUTES.has(`${method} ${pathname}`)) return null;

  const key = req.socket.remoteAddress || "unknown";
  if (limiter.allow(key)) return null;

  return {
    status: 429,
    headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) },
    body: { error: "Too many requests — please slow down and try again shortly." },
  };
}

module.exports = { checkRateLimit };
