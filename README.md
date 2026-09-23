# Gaterelay

Students already traveling somewhere often have spare room to carry something for someone
else on the same route. Gaterelay connects **travelers** (posting a trip, with spare
capacity) with **requesters** (posting a pickup, needing something moved) — matches them
with a deterministic, rule-based algorithm, and confirms the physical handoff with a
one-time code.

This is a deliberately small, fully-understood full-stack project — every architectural
decision below has a stated reason, and nothing in it is AI-generated matching or fake
statistics. It's built to be explained end-to-end in an interview, not just demoed.

## Core flow

```
Register/Login → Post a Trip OR Request a Pickup → Deterministic Matching
→ Accept a Match → OTP Handoff → Complete
```

## Key features

- **Deterministic matching** — exact location match, time-window overlap, and capacity
  are hard requirements; a 0–100 compatibility score and plain-language reasons ("Same
  origin", "Excellent time overlap") explain *why* a match makes sense. No AI, no fuzzy
  matching — the whole algorithm is in one file (`backend/matching.py`) with no database
  access at all, so it's trivially testable and inspectable.
- **Server-side-enforced state machine** — a match can't be accepted twice, an inactive
  trip can't be matched, a completed handoff can't be re-verified. Every one of these is
  checked in the backend, never just in the UI.
- **OTP handoff** — the traveler generates a 6-digit code (hashed, never stored in
  plaintext, 10-minute expiry, 5-attempt lockout) and shows it to the requester in person;
  the requester enters it to confirm the handoff and complete the trip/request.
- **Real authentication** — bcrypt password hashing, JWTs, and ownership checks on every
  protected resource; the backend never trusts a user id supplied by the frontend.

## Tech stack

**Backend:** Python, FastAPI, SQLAlchemy, SQLite, Pydantic, JWT (python-jose), bcrypt
(passlib), pytest.
**Frontend:** React, Vite, plain CSS (a small custom design system, no UI framework),
react-router, lucide-react for icons.

Nothing fancier than that on purpose — no Docker, no message queue, no WebSockets, no AI.
See "Design decisions" below for why SQLite specifically.

## Architecture

```
frontend/          React + Vite SPA
  src/
    pages/          AuthPage, Dashboard, PostTrip, RequestPickup, Matches, Handoff
    components/     Shell (sidebar layout), StatusBadge
    lib/             api.js (fetch wrapper), auth.jsx (auth context), format.js

backend/
  main.py            FastAPI app assembly, CORS, error handling
  database.py         SQLAlchemy engine/session
  models.py            4 tables: User, Trip, Request, Handoff
  schemas.py            Pydantic request/response models
  auth.py                 password hashing, JWT, get_current_user dependency
  matching.py              the deterministic matching engine (pure functions, no DB)
  routes/
    auth.py, trips.py, requests.py, matches.py, handoffs.py
  tests/               73 pytest tests
```

No repository pattern, no service layer, no dependency-injection framework beyond
FastAPI's own `Depends()`. A route function does validation (via the Pydantic schema),
an ownership check, a database operation, and returns — that's the whole pattern,
everywhere.

## Database

Four tables, on purpose:

- **User** — id, name, email (unique), password_hash, created_at
- **Trip** — id, user_id (FK), origin, destination, departure_time, available_capacity,
  status (`ACTIVE → MATCHED → COMPLETED`), created_at
- **Request** — id, user_id (FK), pickup_location, delivery_location, earliest_time,
  latest_time, item_size (1/2/3 = Small/Medium/Large), status (`OPEN → MATCHED →
  COMPLETED`), created_at
- **Handoff** — id, trip_id (FK), request_id (FK), otp_hash, otp_expires_at, otp_attempts,
  status (`PENDING → COMPLETED`), created_at, completed_at

Real foreign keys throughout (`ON DELETE CASCADE`), a unique index on
`handoffs.request_id` (the actual database-level guarantee that a request can't have two
accepted matches — not just an application-level check), and a composite index on
`(status, departure_time)` / `(status, earliest_time, latest_time)` since every matching
query filters on exactly those columns together.

**Matches are computed, not stored.** There's no `Match` table — a match is a live
comparison between an open request and an active trip, always recalculated from current
data. A `match_id` returned by `GET /matches/{request_id}` is just an encoded
`"{trip_id}:{request_id}"` pair, and it is **never trusted as-is**: accepting a match
re-validates every compatibility rule against the database's current state before doing
anything, so a match that went stale between being listed and being accepted (the trip
got taken, the request got cancelled) is correctly rejected rather than silently honored.

## The matching algorithm

All in `backend/matching.py`, pure functions, no side effects:

1. **Location** — normalized (trimmed, case-insensitive) exact match: trip origin must
   equal request pickup location, trip destination must equal request delivery location.
2. **Time** — the trip's departure time must fall within `[earliest_time, latest_time]`.
3. **Capacity** — the trip's available capacity must be ≥ the request's item size.
4. **Status** — trip must be `ACTIVE`, request must be `OPEN`.

All four are hard requirements — a pair that fails any of them isn't a match at all, not
a low-scoring one. For pairs that pass, the score is:

- Same origin: **+40**, same destination: **+40** (effectively constant, since location
  compatibility is a hard requirement — every returned match already has both)
- Time score: **0–20**, based on how centered the trip's departure time is within the
  request's acceptable window. A trip departing near the middle of the window has more
  real-world buffer on both sides than one departing right at an edge — this is what
  actually differentiates one match from another.

This is a deliberately simple, fully rule-based model — the UI never implies it's AI, and
every score can be hand-verified from the three numbers that produced it.

## OTP handoff workflow

```
Match accepted → Handoff created (PENDING)
  → Traveler generates a 6-digit code (SHA-256 hashed, 10-min expiry)
  → Traveler shows the code to the requester in person
  → Requester enters the code
  → Correct code: Handoff → COMPLETED, Trip → COMPLETED, Request → COMPLETED
```

Handled: wrong code (attempt counter increments, 400), expired code (400), 5 wrong
attempts locks further guessing until the traveler regenerates (which resets the
counter), verifying a handoff that's already complete (409), and generating/verifying by
the wrong party (403 — only the traveler generates, only the requester verifies).

**Why SHA-256 for the OTP code but bcrypt for passwords?** A password needs to resist
offline brute-forcing indefinitely, so bcrypt's deliberate slowness is the point. A
6-digit code already has only 1,000,000 possibilities, expires in 10 minutes, and is
capped at 5 guesses — bcrypt's slowness would only add latency here, not real protection.
Using the same tool for both would be applying it without asking whether it fits.

## Design decisions worth explaining

- **SQLite, not Postgres.** Zero setup, the whole database is one inspectable file, and —
  worth knowing — SQLite serializes writers at the file level, so a `check-then-write`
  sequence like accepting a match is safe from races inside one `db.commit()` without
  needing explicit row locking the way a multi-writer database would.
- **One caught bug, fixed at the source, not patched around.** SQLite doesn't reliably
  preserve timezone info through a round-trip the way Postgres does — a value just written
  and a value freshly queried back can end up one timezone-aware, one not, and Python
  refuses to compare them. This crashed OTP verification with a 500 the first time the
  full flow was actually run end-to-end. Fixed by adopting one consistent rule (`naive
  UTC everywhere`, see `models.to_naive_utc`) applied at every point a datetime enters the
  system, not by special-casing the one comparison that happened to crash first.
- **No separate `Match` table.** A match is a computed view over live trip/request data,
  not an entity with its own lifecycle — see "Database" above.
- **Matches are requester-initiated.** The traveler doesn't separately "approve" a match;
  the requester picks which compatible trip to go with, and accepting it is final for
  both sides. Simpler state machine, matches the given flow exactly.

## Known limitations

- No path to free up a trip/request whose handoff was accepted but never completed
  (no "cancel handoff" action) — out of scope for this pass, and the spec's own endpoint
  list doesn't include one.
- JWTs are long-lived (7 days) with no refresh/rotation — a deliberate scope cut for a
  project this size, not an oversight.
- The default JWT secret in `auth.py` is a hardcoded dev value, overridable via
  `JWT_SECRET_KEY` — fine for local use, must be set for anything beyond that.

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend
```bash
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env          # optional — sensible defaults work without it
./venv/bin/uvicorn main:app --reload --port 8000
```
API docs (auto-generated by FastAPI): http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 — the dev server proxies `/api/*` to the backend on :8000.

### Tests
```bash
cd backend
./venv/bin/pytest tests/ -v
```
73 tests: authentication, trip/request CRUD and ownership, the matching engine in
isolation (no DB), match acceptance and its state-transition guards, and the full OTP
handoff lifecycle including expiry and the attempt lockout.
