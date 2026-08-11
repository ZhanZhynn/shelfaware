import { describe, expect, it } from "vitest";
import { parseRangeEnd, parseRangeStart } from "./date-range";

describe("product performance date range", () => {
  it("includes WMS sales throughout a selected date-only end day", () => {
    const end = parseRangeEnd("2026-08-11");
    expect(end?.toISOString()).toBe("2026-08-11T23:59:59.999Z");
    expect(new Date("2026-08-11T18:30:00.000Z").getTime()).toBeLessThanOrEqual(end!.getTime());
  });

  it("rejects invalid calendar dates", () => {
    expect(parseRangeEnd("2026-02-30")).toBeNull();
    expect(parseRangeStart("2026-08-11T00:00:00.000Z")).toBeNull();
  });
});
