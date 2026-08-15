import { describe, expect, it } from "vitest";
import { variantViability } from "./variant-viability";

const completeLine = {
  availability: "available",
  unitPriceRmb: 1.2,
  piecesPerSellingUnit: 1,
  cartonLengthCm: 40,
  cartonWidthCm: 30,
  cartonHeightCm: 50,
  piecesPerCarton: 500,
  marketPriceMyr: 8.9,
  marketPack: 1,
};

describe("variantViability", () => {
  it("passes a complete offer above its canonical minimum viable price", () => {
    expect(variantViability(completeLine, null).status).toBe("pass");
  });

  it("fails when the observed market price is below the break-even price", () => {
    expect(variantViability({ ...completeLine, marketPriceMyr: 0.5 }, null).status).toBe("fail");
  });

  it("requires missing freight and market evidence instead of guessing", () => {
    expect(variantViability({ availability: "available", unitPriceRmb: 1.2 }, null).status).toBe("needs_data");
  });
});
