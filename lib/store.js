"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Tiny synchronous JSON-file "database". This is a student-project scale
 * app running on one box, so a single JSON file with atomic writes (write
 * to a temp file, then rename over the real one) is simpler and safer than
 * pulling in a database dependency, and rename is atomic on POSIX
 * filesystems so a crash mid-write can never leave a half-written file.
 *
 * Shape: {
 *   members:  { [id]: Member },
 *   trips:    { [id]: Trip },
 *   requests: { [id]: Request },
 *   sessions: { [token]: { memberId, createdAt } },
 * }
 * Sessions live in the same file (not a separate in-memory map) so a
 * server restart doesn't silently sign everyone out.
 */

function dbPath() {
  return process.env.GATERELAY_DB || path.join(__dirname, "..", "data.json");
}

function emptyDb() {
  return { members: {}, trips: {}, requests: {}, sessions: {} };
}

function load() {
  const file = dbPath();
  if (!fs.existsSync(file)) return emptyDb();
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return emptyDb();
  try {
    const db = JSON.parse(raw);
    return { ...emptyDb(), ...db };
  } catch (err) {
    throw new Error(`GateRelay database at ${file} is corrupt: ${err.message}`);
  }
}

function save(db) {
  const file = dbPath();
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { load, save, dbPath };
