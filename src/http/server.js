"use strict";

const http = require("http");
const { URL } = require("url");

const store = require("../../lib/store");
const { readJsonBody } = require("./body-parser");
const { resolveSession } = require("./session");
const { checkRateLimit } = require("./rate-limit");
const { logRequest } = require("./logger");
const { serveStatic } = require("./static-files");
const { route } = require("../router");

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...(extraHeaders || {}),
  });
  res.end(payload);
}

async function handleApi(req, pathname) {
  const rateLimited = checkRateLimit(req, pathname, req.method);
  if (rateLimited) return rateLimited;

  const db = store.load(); // one load per request, shared by auth lookup and the handler
  const auth = resolveSession(req, db);

  const body = req.method === "POST" ? await readJsonBody(req) : {};

  return route({ method: req.method, pathname, db, auth, body });
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    handleApi(req, pathname)
      .then(({ status, body, headers }) => {
        sendJson(res, status, body, headers);
        logRequest(req, status, startedAt);
      })
      .catch((err) => {
        const status = err.status || 500;
        if (status >= 500) console.error(err);
        sendJson(res, status, { error: err.message || "Internal server error" });
        logRequest(req, status, startedAt);
      });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, pathname, () => logRequest(req, res.statusCode, startedAt));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
  logRequest(req, 404, startedAt);
});

module.exports = server;
