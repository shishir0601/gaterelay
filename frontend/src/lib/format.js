export const ITEM_SIZE_LABELS = { 1: "Small", 2: "Medium", 3: "Large" };

export function formatDateTime(isoString) {
  // Backend datetimes are naive UTC with no offset suffix (see backend/models.py's
  // to_naive_utc) — appending "Z" here tells the browser's Date parser to treat it as UTC
  // instead of guessing the local timezone, which is what it would otherwise do for a
  // string with no offset at all.
  const withZone = isoString.endsWith("Z") ? isoString : `${isoString}Z`;
  const date = new Date(withZone);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function toApiDateTime(localDateTimeValue) {
  // <input type="datetime-local"> gives a value with no timezone info at all, interpreted
  // by the browser as local time — new Date() on it correctly treats it as local, and
  // .toISOString() converts to the equivalent UTC instant, matching what the backend
  // expects (see backend's to_naive_utc, which converts any aware input to UTC anyway, but
  // sending it pre-converted keeps this explicit and testable rather than implicit).
  return new Date(localDateTimeValue).toISOString();
}
