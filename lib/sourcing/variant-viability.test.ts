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
    expect(variantViability(completeLine, null, completeLine).status).toBe(
      "pass",
    );
  });

  it("fails when the observed market price is below the break-even price", () => {
    expect(
      variantViability(completeLine, null, {
        marketPriceMyr: 0.5,
        marketPack: 1,
      }).status,
    ).toBe("fail");
  });

  it("marks complete costs without a market benchmark as unchecked", () => {
    expect(variantViability(completeLine, null).status).toBe(
      "market_unchecked",
    );
  });

  it("requires missing freight evidence instead of guessing", () => {
    expect(
      variantViability({ availability: "available", unitPriceRmb: 1.2 }, null)
        .status,
    ).toBe("needs_data");
  });
});
