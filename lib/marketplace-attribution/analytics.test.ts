import { beforeEach, describe, expect, it, vi } from "vitest";

const getExchangeRateForDate = vi.hoisted(() => vi.fn());
const refreshExchangeRate = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  marketplaceSkuMapping: { findMany: vi.fn() },
  shopeeOrderItem: { findMany: vi.fn() },
  shopeeProduct: { findMany: vi.fn() },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

vi.mock("@/lib/exchange-rates/service", () => ({
  getExchangeRateForDate,
  refreshExchangeRate,
}));

vi.mock("@/lib/money", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/money")>();
  return { ...actual };
});

import { getCrossChannelPerformance, isUnverifiableLegacyNonvariantLine, mappingIdentity, resolveEffectiveMapping, shopeeOfferKeyForLine } from "./analytics";

describe("effective mapping resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps identical external offers isolated by shop", () => {
    expect(mappingIdentity("shop-a", "shopee:10:2")).not.toBe(mappingIdentity("shop-b", "shopee:10:2"));
  });

  it("selects the mapping interval that contains the sale date", () => {
    const early = { id: "early", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-01-31T23:59:59.999Z") };
    const revised = { id: "revised", effectiveFrom: new Date("2026-02-01"), effectiveTo: null };
    expect(resolveEffectiveMapping([early, revised], new Date("2026-01-15"))?.id).toBe("early");
    expect(resolveEffectiveMapping([early, revised], new Date("2026-02-15"))?.id).toBe("revised");
  });

  it("attributes legacy nonvariant modelId 0 lines to verified product mappings", () => {
    expect(shopeeOfferKeyForLine(10, 0)).toBe("shopee:10:product");
    expect(shopeeOfferKeyForLine(10, null)).toBe("shopee:10:product");
    expect(shopeeOfferKeyForLine(10, 7)).toBe("shopee:10:7");
  });

  it("does not label unresolved variant lines as legacy nonvariant exclusions", () => {
    expect(isUnverifiableLegacyNonvariantLine(null, null)).toBe(true);
    expect(isUnverifiableLegacyNonvariantLine(0, null)).toBe(true);
    expect(isUnverifiableLegacyNonvariantLine(7, null)).toBe(false);
    expect(isUnverifiableLegacyNonvariantLine(null, 10)).toBe(false);
  });

  it("does not attribute a reused model ID from a different item in the same shop", async () => {
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "mapping",
      shopId: "shop-a",
      offerKey: "shopee:10:7",
      salesSkuId: "sku",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      salesSku: { code: "SKU", name: "SKU", familyMemberships: [], recipes: [] },
    }]);
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      { quantity: 2, subtotal: 10, shopeeItemId: 10, shopeeModelId: 7, sku: "SKU", productName: "Chosen", variant: null, order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: new Date("2026-01-02") } },
      { quantity: 9, subtotal: 45, shopeeItemId: 11, shopeeModelId: 7, sku: "OTHER", productName: "Reused model", variant: { shopeeItemId: 10 }, order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: new Date("2026-01-02") } },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);

    const result = await getCrossChannelPerformance(
      new Date("2026-01-01"),
      new Date("2026-01-03"),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ salesSkuId: "sku", offerUnits: 2, mappedLines: 1 }),
    ]);
    expect(result.coverage).toMatchObject({ totalReliableShopeeLines: 2, mappedLines: 1 });
  });

  it("attributes a stable Shopee variant offer through historical mappings, families, and recipes", async () => {
    const preMembershipSaleAt = new Date("2025-12-15T12:00:00.000Z");
    const earlySaleAt = new Date("2026-01-15T12:00:00.000Z");
    const revisedSaleAt = new Date("2026-02-15T12:00:00.000Z");
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "early-mapping",
      shopId: "shop-a",
      offerKey: "shopee:10:7",
      salesSkuId: "early-sales-sku",
      effectiveFrom: new Date("2025-12-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-01-31T23:59:59.999Z"),
      salesSku: {
        code: "BUNDLE-2-OLD",
        name: "Old two-pack",
        family: { id: "legacy-family", name: "Legacy family" },
        familyMemberships: [{
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-01-31T23:59:59.999Z"),
          productFamily: { id: "early-family", name: "Early family" },
        }],
        recipes: [{
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-01-31T23:59:59.999Z"),
          components: [{ productId: "base-product", quantity: 2 }],
        }],
      },
    }, {
      id: "revised-mapping",
      shopId: "shop-a",
      offerKey: "shopee:10:7",
      salesSkuId: "revised-sales-sku",
      effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      effectiveTo: null,
      salesSku: {
        code: "BUNDLE-2",
        name: "Two-pack",
        family: { id: "legacy-family", name: "Legacy family" },
        familyMemberships: [{
          effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
          effectiveTo: null,
          productFamily: { id: "current-family", name: "Current family" },
        }],
        recipes: [{
          effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
          effectiveTo: null,
          components: [{ productId: "base-product", quantity: 2 }],
        }],
      },
    }]);
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([{
      quantity: 1,
      subtotal: 5,
      shopeeItemId: 10,
      shopeeModelId: 7,
      sku: "BUNDLE-2-OLD",
      productName: "Old two-pack",
      variant: null,
      order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: preMembershipSaleAt },
    }, {
      quantity: 2,
      subtotal: 10,
      shopeeItemId: 10,
      shopeeModelId: 7,
      sku: "BUNDLE-2",
      productName: "Two-pack",
      variant: null,
      order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: earlySaleAt },
    }, {
      quantity: 3,
      subtotal: 12.34,
      shopeeItemId: 10,
      shopeeModelId: 7,
      sku: "BUNDLE-2",
      productName: "Two-pack",
      variant: null,
      order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: revisedSaleAt },
    }, {
      quantity: 1,
      subtotal: 4.56,
      shopeeItemId: null,
      shopeeModelId: 0,
      sku: "LEGACY",
      productName: "Legacy product",
      variant: null,
      order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: revisedSaleAt },
    }]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);

    const result = await getCrossChannelPerformance(new Date("2025-12-01T00:00:00.000Z"), new Date("2026-02-28T23:59:59.999Z"));

    expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({
      salesSkuId: "early-sales-sku",
      familyId: "early-family",
      familyName: "Early family",
      offerUnits: 2,
      baseEquivalentUnits: 4,
      nativeRevenueByCurrency: { MYR: { minorUnits: "1000", scale: 2 } },
      mappedLines: 1,
      recipeCoveredLines: 1,
    }), expect.objectContaining({
      salesSkuId: "revised-sales-sku",
      familyId: "current-family",
      familyName: "Current family",
      offerUnits: 3,
      baseEquivalentUnits: 6,
      nativeRevenueByCurrency: { MYR: { minorUnits: "1234", scale: 2 } },
      mappedLines: 1,
      recipeCoveredLines: 1,
    })]));
    expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({ salesSkuId: "early-sales-sku", familyId: null, familyName: null, offerUnits: 1, nativeRevenueByCurrency: { MYR: { minorUnits: "500", scale: 2 } } })]));
    expect(result.familyRows).toEqual(expect.arrayContaining([expect.objectContaining({ familyId: "early-family", offerUnits: 2, baseEquivalentUnits: 4, nativeRevenueByCurrency: { MYR: { minorUnits: "1000", scale: 2 } } }), expect.objectContaining({ familyId: "current-family", offerUnits: 3, baseEquivalentUnits: 6, nativeRevenueByCurrency: { MYR: { minorUnits: "1234", scale: 2 } } })]));
    expect(result.familyRows).not.toEqual(expect.arrayContaining([expect.objectContaining({ familyId: "legacy-family" })]));
    expect(result.coverage).toMatchObject({ totalReliableShopeeLines: 3, mappedLines: 3, unmappedLines: 0, unverifiableLegacyLines: 1, familyAttributionExcludedLines: 1, recipeCoveredLines: 2, mixedRecipeLines: 0 });
  });
});

describe("getCrossChannelPerformance with reportingCurrency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns convertedRevenue and conversionCoverage when reportingCurrency is set", async () => {
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "mapping",
      shopId: "shop-a",
      offerKey: "shopee:10:7",
      salesSkuId: "sku",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      salesSku: { code: "SKU", name: "SKU", familyMemberships: [], recipes: [] },
    }]);
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      { quantity: 2, subtotal: 10, shopeeItemId: 10, shopeeModelId: 7, sku: "SKU", productName: "Chosen", variant: null, order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: new Date("2026-01-02") } },
      { quantity: 3, subtotal: 15, shopeeItemId: 10, shopeeModelId: 7, sku: "SKU", productName: "Chosen", variant: null, order: { shopId: "shop-a", currency: "MYR", shopeeCreatedAt: new Date("2026-01-02") } },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);

    const result = await getCrossChannelPerformance(
      new Date("2026-01-01"),
      new Date("2026-01-03"),
      { reportingCurrency: "MYR" },
    );

    expect(result.reportingCurrency).toBe("MYR");
    expect(result.convertedRevenue).toEqual({ minorUnits: "2500", scale: 2 });
    expect(result.conversionCoverage).toMatchObject({
      convertedCount: 2,
      identityCount: 2,
      excludedCount: 0,
      excludedCurrencies: {},
      fallbackTypeDistribution: { exact: 2, prior: 0, future: 0 },
    });
    expect(getExchangeRateForDate).not.toHaveBeenCalled();
  });
});
