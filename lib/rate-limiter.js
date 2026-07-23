"use strict";

/**
 * A small fixed-window rate limiter. Counts live in memory and reset when
 * the process restarts — not distributed, not persisted. That's the right
 * tradeoff for a single-process, student-scale deployment; a multi-instance
 * deployment would swap this for a shared store (Redis, etc.) without
 * touching any caller, since the interface is just `allow(key)`.
 */
function createRateLimiter({ limit, windowMs }) {
  if (!(limit > 0)) throw new Error("limit must be a positive number");
  if (!(windowMs > 0)) throw new Error("windowMs must be a positive number");

  const hits = new Map(); // key -> { count, windowStart }

  return {
    /** Returns true if `key` may proceed right now, false if it's rate-limited. */
    allow(key, now = Date.now()) {
      const entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    /** Drops all tracked keys — mainly useful for tests. */
    reset() {
      hits.clear();
    },
  };
}

module.exports = { createRateLimiter };
