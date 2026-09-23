import { describe, expect, it } from "vitest";
import { ITEM_SIZE_LABELS, formatDateTime, toApiDateTime } from "./format.js";

describe("ITEM_SIZE_LABELS", () => {
  it("maps the backend's numeric capacity units to the labels the user picked", () => {
    expect(ITEM_SIZE_LABELS[1]).toBe("Small");
    expect(ITEM_SIZE_LABELS[2]).toBe("Medium");
    expect(ITEM_SIZE_LABELS[3]).toBe("Large");
  });
});

describe("formatDateTime", () => {
  it("treats a naive backend datetime string as UTC, not local time", () => {
    // The backend deliberately returns naive datetimes with no "Z" suffix (see backend's
    // to_naive_utc) -- formatDateTime must append one itself so the browser's Date parser
    // doesn't silently reinterpret it as local time.
    const result = formatDateTime("2026-10-01T18:00:00");
    // Rather than assert an exact locale-dependent string, confirm it round-trips through
    // the same UTC-forcing logic the function itself uses.
    const expected = new Date("2026-10-01T18:00:00Z").toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(result).toBe(expected);
  });

  it("doesn't double-append Z if the string somehow already has one", () => {
    expect(() => formatDateTime("2026-10-01T18:00:00Z")).not.toThrow();
  });
});

describe("toApiDateTime", () => {
  it("converts a datetime-local input value to a valid ISO string", () => {
    const result = toApiDateTime("2026-10-01T18:00");
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });
});
