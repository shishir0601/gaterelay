"use strict";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — this API only ever sends small JSON payloads

/** Reads and JSON-parses a request body. Resolves {} for an empty body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

module.exports = { readJsonBody, MAX_BODY_BYTES };
