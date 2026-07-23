const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../lib/rate-limiter");

test("rate limiter: allows requests up to the limit within a window", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 0), false); // 4th call in the same window
});

test("rate limiter: resets once the window elapses", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 500), false); // still inside the window
  assert.equal(limiter.allow("a", 1000), true); // window has rolled over
});

test("rate limiter: tracks each key independently", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("b", 0), true); // different key, unaffected by "a"
  assert.equal(limiter.allow("a", 0), false);
});

test("rate limiter: reset() clears tracked state", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 0), false);
  limiter.reset();
  assert.equal(limiter.allow("a", 0), true);
});

test("rate limiter: rejects a non-positive limit or window", () => {
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1000 }));
  assert.throws(() => createRateLimiter({ limit: 5, windowMs: 0 }));
});
