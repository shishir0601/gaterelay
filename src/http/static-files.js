"use strict";

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJsonError(res, status, message) {
  const payload = JSON.stringify({ error: message });
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function serveStatic(req, res, pathname, onDone) {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJsonError(res, 403, "Forbidden");
    if (onDone) onDone();
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      sendJsonError(res, 404, "Not found");
      if (onDone) onDone();
      return;
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
    if (onDone) onDone();
  });
}

module.exports = { serveStatic };
