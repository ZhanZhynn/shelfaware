import { describe, expect, it } from "vitest";
import { safelyNormalizedUnits } from "./normalization";

describe("family normalization", () => {
  it("normalizes only a single base component", () => expect(safelyNormalizedUnits(3, [{ productId: "a", quantity: 2 }])).toEqual({ units: 6, mixed: false, covered: true }));
  it("excludes mixed recipes rather than allocating revenue arbitrarily", () => expect(safelyNormalizedUnits(3, [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 1 }])).toEqual({ units: null, mixed: true, covered: false }));
});
