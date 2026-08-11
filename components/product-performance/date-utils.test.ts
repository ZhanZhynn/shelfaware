import { describe, expect, it } from "vitest";
import { dateFor, isValidDate } from "./ProductPerformanceDashboard";

describe("product performance date controls", () => {
  it("makes presets inclusive calendar-day ranges", () => {
    expect(dateFor(7, new Date("2026-08-11T12:00:00.000Z"))).toEqual({ dateFrom: "2026-08-05", dateTo: "2026-08-11" });
    expect(dateFor(30, new Date("2026-08-11T12:00:00.000Z"))).toEqual({ dateFrom: "2026-07-13", dateTo: "2026-08-11" });
  });

  it("only accepts real YYYY-MM-DD calendar dates", () => {
    expect(isValidDate("2026-08-11")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-8-11")).toBe(false);
  });
});
