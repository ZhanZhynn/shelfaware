import { describe, expect, it } from "vitest";
import { backfillRequestFingerprint, parseBackfillWindow } from "./route";

describe("backfill request window", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  it("accepts bounded UTC calendar windows", () => {
    expect(parseBackfillWindow("2026-07-01", "2026-07-31", now).windowStart?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
  it("rejects partial, malformed, inverted, future, and unsafe windows", () => {
    expect(() => parseBackfillWindow("2026-07-01", undefined, now)).toThrow("together");
    expect(() => parseBackfillWindow("2026-07-01T00:00:00Z", "2026-07-02", now)).toThrow("UTC calendar");
    expect(() => parseBackfillWindow("2026-07-02", "2026-07-01", now)).toThrow("must not be after");
    expect(() => parseBackfillWindow("2026-08-01", "2026-08-01", now)).toThrow("future");
    expect(() => parseBackfillWindow("2026-06-01", "2026-07-31", now)).toThrow("must not exceed");
  });
});

describe("backfill request idempotency", () => {
  it("binds start, retry, and cancellation keys to their full operational request", () => {
    const base = { platform: "shopee" as const, shopId: "507f1f77bcf86cd799439011", stream: "orders", windowStart: "2026-07-01", windowEnd: "2026-07-31" };
    expect(backfillRequestFingerprint({ ...base, action: "start" })).toBe(backfillRequestFingerprint({ ...base, action: "start" }));
    expect(backfillRequestFingerprint({ ...base, action: "start" })).not.toBe(backfillRequestFingerprint({ ...base, action: "retry" }));
    expect(backfillRequestFingerprint({ ...base, action: "cancel" })).not.toBe(backfillRequestFingerprint({ ...base, action: "cancel", windowEnd: "2026-07-30" }));
  });
});
