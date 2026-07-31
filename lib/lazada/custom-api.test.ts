import { describe, expect, it } from "vitest";
import { validateFinanceDateRange } from "./custom-api";

describe("validateFinanceDateRange", () => {
  it("normalizes a finance range shorter than 180 days", () => {
    expect(validateFinanceDateRange("2026-01-01", "2026-06-29")).toEqual({
      startTime: "2026-01-01",
      endTime: "2026-06-29",
    });
  });

  it("rejects finance ranges of 180 days or longer", () => {
    expect(() => validateFinanceDateRange("2026-01-01", "2026-06-30")).toThrow(/less than 180 days/);
  });
});
