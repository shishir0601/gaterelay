"use strict";

function check() {
  return {
    status: 200,
    body: { ok: true, uptimeSeconds: Math.round(process.uptime()), timestamp: Date.now() },
  };
}

module.exports = { check };
