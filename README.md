# GateRelay

Peer-to-peer campus pickup relay. If your hostel is far from the gate, GateRelay matches your parcel/food pickup requests to someone who's already walking there — instead of everyone making the trip separately.

**Zero runtime dependencies.** Pure Node.js backend (hand-rolled routing, sessions, and rate limiting on top of `http` — no framework), vanilla JS frontend.

## Run it

```bash
npm start
# → http://localhost:3000
```

## Run the tests

```bash
npm test    # 29 tests: matching algorithm + rate limiter + full API integration
```

## The problem this solves

Everyone in a hostel/wing walking to a far gate separately, just to collect their own parcel or food order, is wasted trips. Someone is usually headed there anyway. GateRelay matches "I'm going to the gate between X and Y" against "I need something picked up between A and B."

## The matching algorithm

This is the core of the project — [`lib/match.js`](lib/match.js), fully unit-tested, with zero dependency on the HTTP layer or the database.

1. **Interval overlap.** A request can only be assigned to a trip if their time windows actually overlap — no point matching a carrier leaving now to a request that needs pickup in 3 hours.
2. **Earliest Deadline First (EDF).** When a trip has more eligible requests than capacity, the most time-pressured requests (soonest deadline) are prioritized. This is the same greedy used in real-time scheduling theory, and it's provably optimal for maximizing requests served under a shared capacity constraint.
3. **Reputation-gated capacity.** Carriers with reputation below 50 are capped at carrying 1 item regardless of stated capacity — a new or previously-unreliable carrier shouldn't be handed a stack of parcels.
4. **Value-gated matching.** High-value items only match to carriers with reputation ≥ 80.

Matching runs both ways and stays consistent either way round ([`src/services/matching-service.js`](src/services/matching-service.js)):
- Posting a **trip** pulls in every eligible *pending* request, EDF-ordered, up to capacity.
- Posting a **request** offers it to every open trip (soonest-departing first) and takes the first one with room.

A trip can be **closed** early (it stops accepting new matches, but doesn't touch requests already assigned to it) and a still-**pending** request can be **cancelled** — both were missing early on and are genuinely needed once you've actually posted something you want to take back.

## Trust and security design

Peer-to-peer handoff has real failure modes — the design accounts for them instead of ignoring them:

- **Sessions, not trusted client input.** Checking in (`POST /api/members`) issues a bearer token. Every other route (except the health check) requires it, and the acting member is *always* read from the verified session — never from a client-supplied `carrierId`/`requesterId` in the request body. Earlier versions of this API trusted the body for that, which meant anyone could impersonate any member; that's fixed now.
- **Per-request authorization**, not just authentication. Only the trip's own carrier can close it or confirm a pickup; only a request's own requester can cancel it, confirm delivery, or report a no-show. These are checked against the session, server-side, on every call.
- **Codes are scoped to their owner.** `GET /api/requests` used to return every pending handoff's pickup/delivery codes to any caller. It now redacts them (`null`) for everyone except the request's own requester — see [`src/serializers.js`](src/serializers.js).
- **OTP-style handoff codes.** Every matched request gets a 4-digit pickup code and a separate 4-digit delivery code, exchanged in person. The carrier must be shown the pickup code to confirm they're handing off the right item to the right person; the requester must be shown the delivery code to confirm they're receiving it, not a stranger.
- **Reputation with real consequences**, not just a cosmetic star rating — it directly caps how much a low-trust carrier can take on, and gates who's allowed to carry high-value items.
- **No-show reporting** docks reputation immediately (−20), and disputes that get upheld dock further (−30). Reputation is clamped 0–150 and floors don't let a bad actor recover instantly.
- **Rate limiting** on the routes that create new board entries (`POST /api/members|trips|requests`), so one script can't flood the board — see [`lib/rate-limiter.js`](lib/rate-limiter.js), a pure fixed-window limiter, unit-tested on its own.

**Known limitation:** sessions don't expire — there's no TTL or refresh flow. That's a deliberate scope cut for a single-server student project (see Roadmap), not an oversight.

## API

Every route except the two marked *public* requires `Authorization: Bearer <sessionToken>`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/members` | Check in (idempotent by college ID) — *public*, issues a session token |
| `GET` | `/api/members/:id` | Get a member's current profile + reputation |
| `POST` | `/api/trips` | Post a carrier trip (carrier = the caller) — triggers matching |
| `GET` | `/api/trips` | List trips |
| `POST` | `/api/trips/:id/close` | Carrier closes their own trip early |
| `POST` | `/api/requests` | Post a pickup request (requester = the caller) — triggers matching |
| `GET` | `/api/requests` | List requests (codes redacted unless you're the requester) |
| `POST` | `/api/requests/:id/cancel` | Requester cancels their own still-pending request |
| `POST` | `/api/requests/:id/confirm-pickup` | Assigned carrier confirms with the pickup code |
| `POST` | `/api/requests/:id/confirm-delivery` | Requester confirms with the delivery code — reputation increases |
| `POST` | `/api/requests/:id/report-no-show` | Requester flags a no-show — reputation decreases |
| `GET` | `/api/health` | Liveness check — *public*, no session needed |

## Architecture

```
server.js                     entrypoint — port + graceful shutdown only; requires src/http/server
src/
  http/
    server.js                creates the http.Server: loads the DB, resolves the session, dispatches, logs
    session.js                bearer-token session creation + lookup
    body-parser.js             JSON body reading with a size cap
    rate-limit.js              HTTP-facing wrapper around lib/rate-limiter.js
    logger.js                  one-line request logging
    static-files.js            serves public/, with path-traversal protection
  router.js                    route table (method + regex -> controller), auth-gated by default
  controllers/                 members.js, trips.js, requests.js, health.js — one file per resource
  services/
    matching-service.js        wires the pure lib/match.js engine to live DB state
    codes.js                   4-digit handoff code generation
  validation.js                shared field validators (length caps, timestamp parsing, window checks)
  serializers.js                response shaping, incl. per-viewer code redaction
lib/
  match.js                    matching algorithm + reputation logic — pure, fully tested
  store.js                    JSON-file persistence (atomic writes)
  rate-limiter.js              pure fixed-window rate limiter — fully tested
public/                        vanilla JS frontend — departure-terminal / boarding-pass design system
test/                          29 tests: algorithm + rate limiter (pure) + full API integration
```

`server.js` stays at the repo root and re-exports the `http.Server` built in `src/http/server.js` unchanged, so `npm start` and `require("../server")` in tests didn't need to change when the internals were split apart.

## Design notes

- All matching and reputation logic lives in pure, dependency-free functions (`matchTrip`, `isEligible`, `effectiveCapacity`, `applyReputationEvent`) so it's trivial to unit test without spinning up the server. The rate limiter follows the same pattern.
- `lib/store.js` writes atomically (temp file + rename) so a crash mid-write can never corrupt `data.json`. Sessions live in that same file, so a server restart doesn't silently sign everyone out.
- The whole DB is loaded once per request (not once per auth-check *and* once per handler) and threaded through — see `handleApi` in `src/http/server.js`.
- The frontend polls every 4 seconds rather than using WebSockets — a deliberate simplicity trade-off for a student project; swapping in WebSocket push notifications is a natural next step.
- The UI leans hard into the product's own metaphor: a near-black departure-terminal environment (hairline dividers, amber signage text, monospace digits everywhere a number lives) with warm cream boarding-pass stubs — the things you'd actually hold — sitting on top of it. The "Live gate board" is a real split-flap board: each row is individually-animated character tiles that only flip the characters that actually changed on each poll, cascading left to right like a real airport board. Buttons disable themselves mid-request to prevent double-submits, a lost session drops you back to check-in with an explanation instead of silently failing, and everything respects `prefers-reduced-motion`.

## Roadmap

- [ ] Session expiry + refresh flow
- [ ] Push notifications instead of polling
- [ ] Photo-at-handoff as an optional extra layer of proof
- [ ] Admin dispute review queue
- [ ] Multi-hostel / multi-gate support

## License

MIT
