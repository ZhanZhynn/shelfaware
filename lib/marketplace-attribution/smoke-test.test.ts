import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  salesSku: { findMany: vi.fn() },
  marketplaceOffer: { findMany: vi.fn() },
  marketplaceSkuMapping: { findFirst: vi.fn(), findUnique: vi.fn() },
  marketplaceSourceSalesLine: { findMany: vi.fn() },
  marketplaceOfferPerformanceFact: { upsert: vi.fn() },
  salesSkuPerformanceFact: { upsert: vi.fn() },
  wmsProductSalesFact: { upsert: vi.fn() },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

vi.mock("./fact-projector", () => ({
  projectFactsForSourceLines: vi.fn().mockResolvedValue({
    offerFacts: 1,
    salesSkuFacts: 1,
    wmsFacts: 0,
    skipped: 0,
  }),
}));

vi.mock("./fx-conversion", () => ({
  convertNativeToReporting: vi.fn().mockResolvedValue({
    reportingMinor: 10000n,
    rateDate: new Date(),
    rateProvider: "identity",
    fallbackType: "exact",
  }),
}));

import { runSmokeTests } from "./smoke-test";

const adminActor = { id: "admin1", role: "admin" };
const userActor = { id: "user1", role: "user" };

describe("runSmokeTests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws for non-admin actors", async () => {
    await expect(runSmokeTests(userActor)).rejects.toThrow(
      "Only admins can run smoke tests.",
    );
  });

  it("returns test results for admin actors", async () => {
    prismaMock.salesSku.findMany.mockResolvedValue([
      { id: "sku1", code: "TEST", active: true },
    ]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([
      {
        id: "offer1",
        identityKey: "shopee:100:200",
        internalShopId: "shop1",
      },
    ]);
    prismaMock.marketplaceSkuMapping.findFirst.mockResolvedValue({
      id: "mapping1",
    });
    prismaMock.marketplaceSkuMapping.findUnique.mockResolvedValue({
      id: "mapping1",
      salesSku: { code: "TEST" },
    });
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([]);

    const results = await runSmokeTests(adminActor);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.name && typeof r.passed === "boolean")).toBe(
      true,
    );
  });

  it("testNoInventoryMutationCalls always passes (static check)", async () => {
    prismaMock.salesSku.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([]);

    const results = await runSmokeTests(adminActor);
    const noMutationTest = results.find(
      (r) => r.name === "No inventory mutation calls from new services",
    );

    expect(noMutationTest?.passed).toBe(true);
  });

  it("testCreateAndReadMapping fails when no SalesSku exists", async () => {
    prismaMock.salesSku.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([]);

    const results = await runSmokeTests(adminActor);
    const mappingTest = results.find(
      (r) => r.name === "Create and read one confirmed mapping",
    );

    expect(mappingTest?.passed).toBe(false);
    expect(mappingTest?.detail).toContain("No active SalesSku");
  });

  it("testFxConversionCoverage passes for identity conversion", async () => {
    prismaMock.salesSku.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([]);

    const results = await runSmokeTests(adminActor);
    const fxTest = results.find(
      (r) => r.name === "FX conversion returns coverage metadata",
    );

    expect(fxTest?.passed).toBe(true);
    expect(fxTest?.detail).toContain("identity");
  });
});
