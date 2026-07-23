"use strict";

const MAX_NAME_LENGTH = 60;
const MAX_COLLEGE_ID_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 140;
const MAX_CAPACITY = 20;

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts either an epoch-ms number or anything Date.parse understands (e.g. ISO strings). */
function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Returns an error message string if the window is invalid, otherwise null. */
function validateWindow(windowStart, windowEnd) {
  if (windowStart === null || windowEnd === null) {
    return "windowStart and windowEnd must be valid timestamps";
  }
  if (!(windowEnd > windowStart)) {
    return "windowEnd must be after windowStart";
  }
  return null;
}

module.exports = {
  MAX_NAME_LENGTH,
  MAX_COLLEGE_ID_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_CAPACITY,
  trimmedString,
  parseTimestamp,
  validateWindow,
};
