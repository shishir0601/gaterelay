"use strict";

const members = require("./controllers/members");
const trips = require("./controllers/trips");
const requests = require("./controllers/requests");
const health = require("./controllers/health");

/**
 * Route table. `public: true` marks the only two routes that don't require
 * a session — checking in (that's how you *get* a session) and the health
 * check (deployment platforms need to hit this with no credentials).
 * Every other route requires a valid `Authorization: Bearer <token>`.
 */
const routes = [
  { method: "GET", pattern: /^\/api\/health$/, handler: health.check, public: true },
  { method: "POST", pattern: /^\/api\/members$/, handler: members.checkIn, public: true },
  { method: "GET", pattern: /^\/api\/members\/([^/]+)$/, handler: members.getById },

  { method: "POST", pattern: /^\/api\/trips$/, handler: trips.create },
  { method: "GET", pattern: /^\/api\/trips$/, handler: trips.list },
  { method: "POST", pattern: /^\/api\/trips\/([^/]+)\/close$/, handler: trips.close },

  { method: "POST", pattern: /^\/api\/requests$/, handler: requests.create },
  { method: "GET", pattern: /^\/api\/requests$/, handler: requests.list },
  { method: "POST", pattern: /^\/api\/requests\/([^/]+)\/cancel$/, handler: requests.cancel },
  { method: "POST", pattern: /^\/api\/requests\/([^/]+)\/confirm-pickup$/, handler: requests.confirmPickup },
  { method: "POST", pattern: /^\/api\/requests\/([^/]+)\/confirm-delivery$/, handler: requests.confirmDelivery },
  { method: "POST", pattern: /^\/api\/requests\/([^/]+)\/report-no-show$/, handler: requests.reportNoShow },
];

function route({ method, pathname, db, auth, body }) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(pathname);
    if (!match) continue;

    if (!r.public && !auth) {
      return { status: 401, body: { error: "Sign in with a valid session to do that." } };
    }

    const params = match.slice(1);
    return r.handler({ db, auth, params, body });
  }
  return { status: 404, body: { error: "Not found" } };
}

module.exports = { route };
