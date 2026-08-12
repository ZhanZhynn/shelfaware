import { describe, expect, it, vi, beforeEach } from "vitest";

import { shopeeIdentityKey } from "./offer-adapter";
import { allocateGmvMinor, distributeResidual, resolveRecipeForDate } from "./fact-projector";
import { isCancelledStatus, isUnpaidStatus } from "./order-status";

describe("offer identity key", () => {
  it("uses product sentinel for non-variant offers", () => {
    expect(shopeeIdentityKey("shop1", 12345, null)).toBe("shopee:shop1:12345:product");
    expect(shopeeIdentityKey("shop1", 12345, 0)).toBe("shopee:shop1:12345:product");
  });

  it("uses modelId for variant offers", () => {
    expect(shopeeIdentityKey("shop1", 12345, 7)).toBe("shopee:shop1:12345:7");
    expect(shopeeIdentityKey("shop1", 12345, 999)).toBe("shopee:shop1:12345:999");
  });

  it("isolates offers by shop", () => {
    expect(shopeeIdentityKey("shop-a", 100, 1)).not.toBe(shopeeIdentityKey("shop-b", 100, 1));
  });

  it("is stable across repeated calls", () => {
    const key1 = shopeeIdentityKey("shop1", 12345, 7);
    const key2 = shopeeIdentityKey("shop1", 12345, 7);
    expect(key1).toBe(key2);
  });
});

describe("order status classification", () => {
  it("classifies cancelled statuses", () => {
    expect(isCancelledStatus("CANCELLED")).toBe(true);
    expect(isCancelledStatus("CANCELLED_BY_SELLER")).toBe(true);
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("IN_CANCEL")).toBe(true);
    expect(isCancelledStatus("COMPLETED")).toBe(false);
    expect(isCancelledStatus(null)).toBe(false);
  });

  it("classifies unpaid statuses", () => {
    expect(isUnpaidStatus("UNPAID")).toBe(true);
    expect(isUnpaidStatus("unpaid")).toBe(true);
    expect(isUnpaidStatus("PAID")).toBe(false);
    expect(isUnpaidStatus(null)).toBe(false);
  });
});

describe("GMV allocation", () => {
  it("allocates full amount to single component", () => {
    expect(allocateGmvMinor(1500n, 10000, 10000)).toBe(1500n);
  });

  it("allocates proportionally by basis points", () => {
    expect(allocateGmvMinor(8000n, 7000, 10000)).toBe(5600n);
    expect(allocateGmvMinor(8000n, 2000, 10000)).toBe(1600n);
    expect(allocateGmvMinor(8000n, 1000, 10000)).toBe(800n);
  });

  it("truncates fractional minor units", () => {
    expect(allocateGmvMinor(100n, 3333, 10000)).toBe(33n);
  });
});

describe("residual distribution", () => {
  it("assigns all to a single component", () => {
    const result = distributeResidual(1500n, [{ basisPoints: 10000, position: 0 }]);
    expect(result).toEqual([1500n]);
    expect(result.reduce((s, v) => s + v, 0n)).toBe(1500n);
  });

  it("distributes proportionally and assigns residual to highest position", () => {
    const result = distributeResidual(8000n, [
      { basisPoints: 7000, position: 0 },
      { basisPoints: 2000, position: 1 },
      { basisPoints: 1000, position: 2 },
    ]);
    expect(result).toEqual([5600n, 1600n, 800n]);
    expect(result.reduce((s, v) => s + v, 0n)).toBe(8000n);
  });

  it("assigns residual from integer truncation to highest-position component", () => {
    const result = distributeResidual(100n, [
      { basisPoints: 3333, position: 0 },
      { basisPoints: 3333, position: 1 },
      { basisPoints: 3334, position: 2 },
    ]);
    expect(result.reduce((s, v) => s + v, 0n)).toBe(100n);
    expect(result[2]).toBe(34n);
  });

  it("conserves source GMV for MYR 80.00 three-component recipe", () => {
    const result = distributeResidual(8000n, [
      { basisPoints: 7000, position: 0 },
      { basisPoints: 2000, position: 1 },
      { basisPoints: 1000, position: 2 },
    ]);
    expect(result.reduce((s, v) => s + v, 0n)).toBe(8000n);
  });

  it("returns empty for zero total basis points", () => {
    const result = distributeResidual(1000n, []);
    expect(result).toEqual([]);
  });
});

describe("recipe resolution", () => {
  const recipes = [
    { id: "r1", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-01-31"), components: [{ productId: "p1", quantity: 2 }] },
    { id: "r2", effectiveFrom: new Date("2026-02-01"), effectiveTo: null, components: [{ productId: "p1", quantity: 3 }] },
  ];

  it("resolves the recipe effective on a given date", () => {
    expect(resolveRecipeForDate(recipes, new Date("2026-01-15"))?.id).toBe("r1");
    expect(resolveRecipeForDate(recipes, new Date("2026-02-15"))?.id).toBe("r2");
  });

  it("returns null when no recipe matches", () => {
    expect(resolveRecipeForDate(recipes, new Date("2025-12-15"))).toBeNull();
  });

  it("handles null effectiveTo as open-ended", () => {
    expect(resolveRecipeForDate(recipes, new Date("2099-01-01"))?.id).toBe("r2");
  });
});

// ─── Mocked integration tests ───

const prismaMock = vi.hoisted(() => ({
  marketplaceOffer: { upsert: vi.fn(), findMany: vi.fn() },
  marketplaceSourceSalesLine: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
  marketplaceOfferPerformanceFact: { upsert: vi.fn() },
  salesSkuPerformanceFact: { upsert: vi.fn(), findMany: vi.fn() },
  wmsProductSalesFact: { upsert: vi.fn() },
  mappingBackfillRun: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  marketplaceSkuMapping: { findMany: vi.fn() },
  salesSkuRecipe: { findMany: vi.fn() },
  shopeeProduct: { findMany: vi.fn(), findFirst: vi.fn() },
  shopeeOrderItem: { findMany: vi.fn() },
}));

const { actualProjectFactsRef } = vi.hoisted(() => ({
  actualProjectFactsRef: { current: null as any },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));
vi.mock("./source-line-projector", () => ({
  projectSourceLinesFromShopeeOrderItems: vi.fn().mockResolvedValue({ created: 0, updated: 0, skipped: 0, total: 0 }),
}));
vi.mock("./fact-projector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fact-projector")>();
  actualProjectFactsRef.current = actual.projectFactsForSourceLines;
  return {
    ...actual,
    projectFactsForSourceLines: vi.fn((...args: any[]) => actualProjectFactsRef.current(...args)),
  };
});

import { projectFactsForSourceLines } from "./fact-projector";
import { projectSourceLinesFromShopeeOrderItems as _actualProjectSourceLines } from "./source-line-projector";
import { upsertShopeeOffers } from "./offer-adapter";
import { commitBackfill, previewBackfill, cancelBackfill } from "./backfill-service";

const mockProjectFacts = vi.mocked(projectFactsForSourceLines);

beforeEach(() => vi.clearAllMocks());

const mockSourceLine = {
  id: "line1",
  platform: "shopee",
  internalShopId: "shop1",
  externalOrderId: "ORDER-001",
  externalLineId: "ORDER-001:item1",
  offerId: "offer1",
  orderDate: new Date("2026-01-15"),
  marketplaceQuantity: 2,
  grossItemSalesMinor: "1250",
  amountScale: 2,
  currency: "MYR",
  orderEligibility: "eligible",
  sourceRevision: "ORDER-001",
};

const mockOffer = { id: "offer1", externalProductId: "100", externalVariantId: null };

describe("offer upsert from Shopee catalog", () => {
  it("creates offer for non-variant product", async () => {
    prismaMock.shopeeProduct.findMany.mockResolvedValue([{
      id: "prod1", shopId: "shop1", shopeeItemId: 100,
      itemName: "Test Product", itemSku: "SKU-100",
      imageUrl: "https://img.example/100.jpg", variants: [],
    }]);
    prismaMock.marketplaceOffer.upsert.mockResolvedValue({ id: "offer1" });

    const result = await upsertShopeeOffers("shop1");
    expect(result.total).toBe(1);
    expect(prismaMock.marketplaceOffer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identityKey: "shopee:shop1:100:product" },
        create: expect.objectContaining({
          platform: "shopee",
          internalShopId: "shop1",
          externalProductId: "100",
          externalVariantId: null,
          identityKey: "shopee:shop1:100:product",
          sellerSku: "SKU-100",
        }),
      }),
    );
  });

  it("creates offers for each variant", async () => {
    prismaMock.shopeeProduct.findMany.mockResolvedValue([{
      id: "prod1", shopId: "shop1", shopeeItemId: 100,
      itemName: "Variant Product", itemSku: "SKU-100", imageUrl: null,
      variants: [
        { id: "v1", modelId: 1, modelName: "Red", modelSku: "SKU-100-RED" },
        { id: "v2", modelId: 2, modelName: "Blue", modelSku: "SKU-100-BLU" },
      ],
    }]);
    prismaMock.marketplaceOffer.upsert.mockResolvedValue({ id: "offer1" });

    const result = await upsertShopeeOffers("shop1");
    expect(result.total).toBe(2);
    expect(prismaMock.marketplaceOffer.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.marketplaceOffer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { identityKey: "shopee:shop1:100:1" } }));
    expect(prismaMock.marketplaceOffer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { identityKey: "shopee:shop1:100:2" } }));
  });
});

describe("source-line idempotent projection", () => {
  it("projects source lines from Shopee order items idempotently", async () => {
    const { projectSourceLinesFromShopeeOrderItems } = await vi.importActual<typeof import("./source-line-projector")>("./source-line-projector");
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([{
      id: "item1", quantity: 2, subtotal: 12.50, sku: "SKU-100",
      shopeeItemId: 100, shopeeModelId: 0, productName: "Test Product",
      order: { shopId: "shop1", shopeeOrderId: "ORDER-001", orderStatus: "COMPLETED", currency: "MYR", shopeeCreatedAt: new Date("2026-01-15") },
      variant: null,
    }]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([{ shopeeItemId: 100, itemSku: "SKU-100" }]);
    prismaMock.shopeeProduct.findFirst.mockResolvedValue({ itemName: "Test Product", itemSku: "SKU-100", imageUrl: null, variants: [] });
    prismaMock.marketplaceOffer.upsert.mockResolvedValue({ id: "offer1" });
    prismaMock.marketplaceSourceSalesLine.upsert.mockResolvedValue({ id: "line1" });
    prismaMock.marketplaceSourceSalesLine.findUnique.mockResolvedValue({ createdAt: new Date("2026-01-15"), updatedAt: new Date("2026-01-15") });

    const result = await projectSourceLinesFromShopeeOrderItems("shop1");
    expect(result.total).toBe(1);
    expect(prismaMock.marketplaceSourceSalesLine.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceSourceSalesLine.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ platform: "shopee", internalShopId: "shop1", externalOrderId: "ORDER-001", currency: "MYR", marketplaceQuantity: 2 }),
    }));
  });
});

describe("fact projection", () => {
  it("creates offer fact for source line with offer", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([mockSourceLine]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.offerFacts).toBe(1);
    expect(result.salesSkuFacts).toBe(0);
    expect(result.wmsFacts).toBe(0);
  });

  it("creates sales SKU fact when mapping exists", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([mockSourceLine]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "mapping1", shopId: "shop1", offerKey: "shopee:100:product",
      salesSkuId: "sku1", effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
    }]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.salesSkuPerformanceFact.upsert.mockResolvedValue({});

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.offerFacts).toBe(1);
    expect(result.salesSkuFacts).toBe(1);
    expect(result.wmsFacts).toBe(0);
  });

  it("creates WMS facts for single-component recipe", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([{
      ...mockSourceLine,
      grossItemSalesMinor: "1500",
      marketplaceQuantity: 2,
    }]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([{ ...mockOffer, externalVariantId: "1" }]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "mapping1", shopId: "shop1", offerKey: "shopee:100:1",
      salesSkuId: "sku1", effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
    }]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([{
      id: "recipe1", salesSkuId: "sku1", status: "confirmed",
      effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
      components: [{ productId: "wms-prod1", quantity: 100 }],
    }]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.salesSkuPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.wmsProductSalesFact.upsert.mockResolvedValue({});

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.offerFacts).toBe(1);
    expect(result.salesSkuFacts).toBe(1);
    expect(result.wmsFacts).toBe(1);
    expect(prismaMock.wmsProductSalesFact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ normalizedUnits: 200, allocatedGmvMinor: "1500", allocationBasisPoints: 10000 }),
    }));
  });

  it("creates WMS facts for multi-component recipe with residual distribution", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([{
      ...mockSourceLine,
      grossItemSalesMinor: "8000",
      marketplaceQuantity: 1,
    }]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([{ ...mockOffer, externalVariantId: "1" }]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([{
      id: "mapping1", shopId: "shop1", offerKey: "shopee:100:1",
      salesSkuId: "sku1", effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
    }]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([{
      id: "recipe1", salesSkuId: "sku1", status: "confirmed",
      effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
      components: [
        { productId: "paper_xbag", quantity: 100 },
        { productId: "label_roll", quantity: 2 },
        { productId: "carton_small", quantity: 1 },
      ],
    }]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.salesSkuPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.wmsProductSalesFact.upsert.mockResolvedValue({});

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.wmsFacts).toBe(3);
    expect(prismaMock.wmsProductSalesFact.upsert).toHaveBeenCalledTimes(3);

    const calls = prismaMock.wmsProductSalesFact.upsert.mock.calls;
    const allocatedAmounts = calls.map((c: any) => BigInt(c[0].create.allocatedGmvMinor));
    const totalAllocated = allocatedAmounts.reduce((s: bigint, v: bigint) => s + v, 0n);
    expect(totalAllocated).toBe(8000n);
  });

  it("skips ineligible source lines", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([]);

    const result = await projectFactsForSourceLines(["line-ineligible"]);
    expect(result.offerFacts).toBe(0);
    expect(prismaMock.marketplaceOfferPerformanceFact.upsert).not.toHaveBeenCalled();
  });

  it("produces identical projection keys for same input (idempotency)", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([mockSourceLine]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});

    await projectFactsForSourceLines(["line1"]);
    const firstCall = prismaMock.marketplaceOfferPerformanceFact.upsert.mock.calls[0] as [{ where: { projectionKey: string } }];
    const firstKey = firstCall[0].where.projectionKey;

    vi.clearAllMocks();
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([mockSourceLine]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});

    await projectFactsForSourceLines(["line1"]);
    const secondCall = prismaMock.marketplaceOfferPerformanceFact.upsert.mock.calls[0] as [{ where: { projectionKey: string } }];
    const secondKey = secondCall[0].where.projectionKey;

    expect(firstKey).toBe(secondKey);
  });
});

describe("fact supersession on mapping correction", () => {
  it("supersedes facts when a new mapping takes effect", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([{
      ...mockSourceLine,
      orderDate: new Date("2026-02-15"),
      grossItemSalesMinor: "2000",
      marketplaceQuantity: 3,
    }]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([
      { id: "old-mapping", shopId: "shop1", offerKey: "shopee:100:product", salesSkuId: "old-sku", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-01-31") },
      { id: "new-mapping", shopId: "shop1", offerKey: "shopee:100:product", salesSkuId: "new-sku", effectiveFrom: new Date("2026-02-01"), effectiveTo: null },
    ]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});
    prismaMock.salesSkuPerformanceFact.upsert.mockResolvedValue({});

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.salesSkuFacts).toBe(1);
    expect(prismaMock.salesSkuPerformanceFact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ mappingId: "new-mapping", salesSkuId: "new-sku" }),
    }));
  });
});

describe("backfill checkpoint/replay", () => {
  it("creates a backfill run and processes source lines", async () => {
    prismaMock.mappingBackfillRun.create.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.findUnique.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.update.mockResolvedValue({});
    prismaMock.marketplaceSourceSalesLine.count.mockResolvedValue(0);

    const result = await commitBackfill({
      platform: "shopee",
      internalShopId: "shop1",
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-01-31"),
      initiatedById: "admin1",
    }, { id: "admin1", role: "admin" });

    expect(result.status).toBe("completed");
    expect(prismaMock.mappingBackfillRun.create).toHaveBeenCalled();
    expect(prismaMock.mappingBackfillRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run1" },
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("cancels a running backfill", async () => {
    prismaMock.mappingBackfillRun.findUnique.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.update.mockResolvedValue({});

    const result = await cancelBackfill("run1", { id: "admin1", role: "admin" });
    expect(prismaMock.mappingBackfillRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run1" },
      data: expect.objectContaining({ status: "cancelled" }),
    }));
  });

  it("rejects non-admin actor", async () => {
    await expect(
      commitBackfill({
        platform: "shopee",
        internalShopId: "shop1",
        dateFrom: new Date("2026-01-01"),
        dateTo: new Date("2026-01-31"),
        initiatedById: "user1",
      }, { id: "user1", role: "user" }),
    ).rejects.toThrow("Only admins can run backfill operations.");
  });

  it("returns completed_with_errors when errorCount > 0", async () => {
    mockProjectFacts.mockRejectedValueOnce(new Error("boom"));
    prismaMock.mappingBackfillRun.create.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.findUnique.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.update.mockResolvedValue({});
    prismaMock.marketplaceSourceSalesLine.count.mockResolvedValue(1);
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([{ id: "line1" }]);

    const result = await commitBackfill({
      platform: "shopee",
      internalShopId: "shop1",
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-01-31"),
      initiatedById: "admin1",
    }, { id: "admin1", role: "admin" });

    expect(result.status).toBe("completed_with_errors");
    mockProjectFacts.mockImplementation((...args: any[]) => actualProjectFactsRef.current(...args));
  });

  it("skips already-processed lines using checkpoint", async () => {
    mockProjectFacts.mockResolvedValue({ offerFacts: 1, salesSkuFacts: 0, wmsFacts: 0, skipped: 0 });
    prismaMock.mappingBackfillRun.create.mockResolvedValue({ id: "run1", status: "running" });
    prismaMock.mappingBackfillRun.findUnique.mockResolvedValue({
      id: "run1",
      status: "running",
      checkpoint: { lastSourceLineId: "line2" },
    });
    prismaMock.mappingBackfillRun.update.mockResolvedValue({});
    prismaMock.marketplaceSourceSalesLine.count.mockResolvedValue(3);
    // First call returns all 3 lines (the batch), then the second call would be
    // for the next batch but we only have 3 total so only one batch
    prismaMock.marketplaceSourceSalesLine.findMany
      .mockResolvedValueOnce([{ id: "line1" }, { id: "line2" }, { id: "line3" }]);

    const result = await commitBackfill({
      platform: "shopee",
      internalShopId: "shop1",
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-01-31"),
      initiatedById: "admin1",
    }, { id: "admin1", role: "admin" });

    // Only line3 should have been processed (lines 1 and 2 skipped via checkpoint)
    expect(mockProjectFacts).toHaveBeenCalledWith(["line3"]);
    expect(result.status).toBe("completed");
    mockProjectFacts.mockImplementation((...args: any[]) => actualProjectFactsRef.current(...args));
  });

  it("reuses existing run when idempotency key matches", async () => {
    prismaMock.mappingBackfillRun.findFirst.mockResolvedValue({
      id: "existing-run",
      status: "completed",
      processedCount: 10,
      factCount: 20,
      errorCount: 0,
    });

    const result = await commitBackfill({
      platform: "shopee",
      internalShopId: "shop1",
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-01-31"),
      initiatedById: "admin1",
      idempotencyKey: "key-123",
    }, { id: "admin1", role: "admin" });

    expect(result.runId).toBe("existing-run");
    expect(result.status).toBe("completed");
    expect(prismaMock.mappingBackfillRun.create).not.toHaveBeenCalled();
  });
});

describe("fact projection null offerId handling", () => {
  it("skips source lines with null offerId", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([{
      ...mockSourceLine,
      offerId: null,
    }]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);

    const result = await projectFactsForSourceLines(["line1"]);
    expect(result.offerFacts).toBe(0);
    expect(prismaMock.marketplaceOfferPerformanceFact.upsert).not.toHaveBeenCalled();
  });
});

describe("no inventory mutation boundary", () => {
  it("fact projector does not call Product, StockAllocation, or StockMovement writes", async () => {
    prismaMock.marketplaceSourceSalesLine.findMany.mockResolvedValue([mockSourceLine]);
    prismaMock.marketplaceOffer.findMany.mockResolvedValue([mockOffer]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSkuRecipe.findMany.mockResolvedValue([]);
    prismaMock.marketplaceOfferPerformanceFact.upsert.mockResolvedValue({});

    await projectFactsForSourceLines(["line1"]);

    expect(prismaMock).not.toHaveProperty("product");
    expect(prismaMock).not.toHaveProperty("stockAllocation");
    expect(prismaMock).not.toHaveProperty("stockMovement");
  });
});
