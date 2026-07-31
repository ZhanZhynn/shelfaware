import { describe, expect, it } from "vitest";
import { legacyKnownNumber, legacySum } from "./legacy-quality";

describe("legacy financial containment", () => {
  it("does not turn an unknown legacy value into zero", () => {
    expect(legacyKnownNumber(null, { financialQuality: "legacy-unverified" }, true)).toBeNull();
    expect(legacySum([{ value: null, financialQuality: "legacy-unverified" }], true)).toBeNull();
  });

  it("retains an explicitly observed zero", () => {
    expect(legacyKnownNumber(0, { financialQuality: "verified" }, true)).toBe(0);
    expect(legacySum([{ value: 0, financialQuality: "verified" }], true)).toBe(0);
  });
});
