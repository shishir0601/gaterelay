"use strict";

function logRequest(req, status, startedAt) {
  const ms = Date.now() - startedAt;
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${status} ${ms}ms`);
}

module.exports = { logRequest };
