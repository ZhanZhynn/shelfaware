import { describe, expect, it } from "vitest";
import {
  allocateLandedCost,
  calculateSourcingLandedCost,
  estimateLandedCost,
} from "./landed-cost";

describe("estimateLandedCost", () => {
  it("includes freight, duty, tax, and other costs in unit landed cost", () => {
    expect(
      estimateLandedCost({
        quantity: 100,
        unitPriceCny: 10,
        fxRate: 0.65,
        freightMyr: 100,
        dutyRate: 10,
        taxRate: 6,
        otherCostMyr: 50,
      }),
    ).toMatchObject({
      goodsMyr: 650,
      dutyMyr: 75,
      taxMyr: 49.5,
      totalMyr: 924.5,
      unitLandedMyr: 9.245,
    });
  });

  it("tracks insurance and local delivery as explicit components", () => {
    expect(
      estimateLandedCost({
        quantity: 10,
        unitPriceCny: 10,
        fxRate: 1,
        insuranceMyr: 5,
        localDeliveryMyr: 15,
      }),
    ).toMatchObject({
      insuranceMyr: 5,
      localDeliveryMyr: 15,
      totalMyr: 120,
      unitLandedMyr: 12,
    });
  });
});

describe("allocateLandedCost", () => {
  it("allocates actual charges by accepted quantity without losing rounding cents", () => {
    expect(allocateLandedCost(10, [1, 2, 3])).toEqual([1.67, 3.33, 5]);
  });

  it("does not allocate a charge when nothing was accepted", () => {
    expect(allocateLandedCost(10, [0, 0])).toEqual([0, 0]);
  });
});

describe("calculateSourcingLandedCost", () => {
  it("matches the cake board D-Day test vector", () => {
    const result = calculateSourcingLandedCost({
      unitCostCny: 1.2,
      piecesPerSellingUnit: 1,
      cartonLengthCm: 40,
      cartonWidthCm: 30,
      cartonHeightCm: 50,
      piecesPerCarton: 500,
      marketPriceMyr: 8.9,
      marketPack: 1,
    });
    expect(result?.cartonM3).toBeCloseTo(0.06, 10);
    expect(result?.freightPerPiece).toBeCloseTo(0.0492, 10);
    expect(result?.productCostPerPiece).toBeCloseTo(0.78324, 10);
    expect(result?.landed).toBeCloseTo(0.83244, 10);
    expect(result?.netRevenue).toBeCloseTo(5.963, 10);
    expect(result?.minViablePrice).toBeCloseTo(1.2424477611940298, 10);
    expect(result?.profitPerPiece).toBeCloseTo(5.13056, 10);
    expect(result?.roi).toBeCloseTo(6.1632, 3);
    expect(result?.flags).toEqual([]);
  });

  it("flags excluded freight when carton information is incomplete", () => {
    const result = calculateSourcingLandedCost({
      unitCostCny: 1.2,
      piecesPerSellingUnit: 1,
      marketPriceMyr: 8.9,
      marketPack: 1,
    });
    expect(result).toMatchObject({ freightPerPiece: 0, landed: 0.78324 });
    expect(result?.flags).toContain("freight_excluded");
  });

  it("normalizes supplier and competitor pack counts independently", () => {
    const result = calculateSourcingLandedCost({
      unitCostCny: 18,
      piecesPerSellingUnit: 50,
      cartonLengthCm: 52,
      cartonWidthCm: 38,
      cartonHeightCm: 34,
      piecesPerCarton: 2000,
      marketPriceMyr: 25.9,
      marketPack: 10,
    });
    expect(result).toMatchObject({ cartonM3: 0.067184, marketPerPiece: 2.59 });
    expect(result?.productCostPerPiece).toBeCloseTo(0.234972, 10);
    expect(result?.freightPerPiece).toBeCloseTo(0.01377272, 10);
    expect(result?.landed).toBeCloseTo(0.24874472, 10);
  });

  it("returns landed cost and pricing guidance without inventing profit", () => {
    const result = calculateSourcingLandedCost({
      unitCostCny: 2.3,
      piecesPerSellingUnit: 1,
      cartonLengthCm: 60,
      cartonWidthCm: 40,
      cartonHeightCm: 40,
      piecesPerCarton: 300,
    });
    expect(result?.landed).toBeCloseTo(1.63241, 10);
    expect(result).toMatchObject({
      marketPerPiece: null,
      profitPerPiece: null,
      roi: null,
      marginPercent: null,
    });
    expect(result?.flags).toContain("no_market_price");
  });

  it("uses a per-piece shipping override, including an intentional zero", () => {
    const result = calculateSourcingLandedCost({
      unitCostCny: 1.2,
      piecesPerSellingUnit: 1,
      shippingOverrideMyrPerPiece: 0,
    });
    expect(result).toMatchObject({
      freightPerPiece: 0,
      shippingOverrideMyrPerPiece: 0,
      landed: 0.78324,
    });
    expect(result?.flags).toContain("shipping_overridden");
    expect(result?.flags).not.toContain("freight_excluded");
  });
});
