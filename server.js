"use strict";

/**
 * Entrypoint. The actual server is built in src/http/server.js — this file
 * only owns process-level concerns: which port to listen on, and shutting
 * down cleanly on SIGINT/SIGTERM. Kept at the repo root (rather than inside
 * src/) so `node server.js` / `npm start` and `require("../server")` in
 * tests both keep working unchanged.
 */

const server = require("./src/http/server");

const PORT = process.env.PORT || 3000;

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down GateRelay...`);
  server.close(() => process.exit(0));
  // Don't hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 5000).unref();
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`GateRelay listening on http://localhost:${PORT}`);
  });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = server;
