import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  productChannelMapping: { findMany: vi.fn() },
  marketplaceSkuMapping: { findMany: vi.fn() },
  salesSku: { findMany: vi.fn() },
  shopeeProduct: { findMany: vi.fn() },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { proposeMigrationCandidates } from "./migration-assistant";

describe("proposeMigrationCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.salesSku.findMany.mockResolvedValue([
      { id: "sku1", code: "PROD-A" },
    ]);
  });

  it("returns empty result when no legacy rows exist", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);

    const result = await proposeMigrationCandidates();

    expect(result.summary).toEqual({
      totalLegacyRows: 0,
      proposedCandidates: 0,
      ambiguousRows: 0,
      skippedRows: 0,
      alreadyMappedRows: 0,
      noSkuMatchRows: 0,
    });
    expect(result.candidates).toEqual([]);
  });

  it("proposes variant candidates from legacy variant mappings", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([
      {
        id: "pcm1",
        wmsProductId: "wms1",
        channel: "shopee",
        channelProductId: "cp1",
        channelType: "variant",
        createdAt: new Date(),
        wmsProduct: { id: "wms1", sku: "PROD-A", name: "Product A" },
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      {
        id: "cp1",
        shopId: "shop1",
        shopeeItemId: 12345,
        itemSku: "PROD-A",
        variants: [
          { id: "v1", modelId: 67890, modelSku: "PROD-A" },
        ],
      },
    ]);

    const result = await proposeMigrationCandidates();

    expect(result.summary.totalLegacyRows).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      platform: "shopee",
      shopId: "shop1",
      externalProductId: "12345",
      externalVariantId: "67890",
      offerKind: "variant",
      proposedSalesSkuId: "sku1",
      proposedSalesSkuCode: "PROD-A",
      confidence: "legacy-migration-exact",
      ambiguous: false,
      alreadyMapped: false,
    });
    expect(result.summary.proposedCandidates).toBe(1);
  });

  it("flags ambiguous rows when multiple legacy rows point to same Shopee product", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([
      {
        id: "pcm1",
        wmsProductId: "wms1",
        channel: "shopee",
        channelProductId: "cp1",
        channelType: "product",
        createdAt: new Date(),
        wmsProduct: { id: "wms1", sku: "SKU-A", name: "Product A" },
      },
      {
        id: "pcm2",
        wmsProductId: "wms2",
        channel: "shopee",
        channelProductId: "cp1",
        channelType: "product",
        createdAt: new Date(),
        wmsProduct: { id: "wms2", sku: "SKU-B", name: "Product B" },
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      {
        id: "cp1",
        shopId: "shop1",
        shopeeItemId: 111,
        itemSku: "SKU-A",
        variants: [],
      },
    ]);

    const result = await proposeMigrationCandidates();

    expect(result.summary.totalLegacyRows).toBe(2);
    expect(result.summary.ambiguousRows).toBe(2);
    expect(result.candidates.every((c) => c.ambiguous)).toBe(true);
    expect(result.candidates[0]?.ambiguityReason).toContain(
      "Multiple legacy",
    );
  });

  it("marks already-mapped offers correctly", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([
      {
        id: "pcm1",
        wmsProductId: "wms1",
        channel: "shopee",
        channelProductId: "cp1",
        channelType: "variant",
        createdAt: new Date(),
        wmsProduct: { id: "wms1", sku: "PROD-A", name: "Product A" },
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      {
        id: "cp1",
        shopId: "shop1",
        shopeeItemId: 100,
        itemSku: "PROD-A",
        variants: [{ id: "v1", modelId: 200, modelSku: "PROD-A" }],
      },
    ]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([
      { shopId: "shop1", offerKey: "shopee:100:200" },
    ]);

    const result = await proposeMigrationCandidates();

    expect(result.summary.alreadyMappedRows).toBe(1);
    expect(result.candidates[0]?.alreadyMapped).toBe(true);
  });

  it("skips rows when channel product not found", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([
      {
        id: "pcm1",
        wmsProductId: "wms1",
        channel: "shopee",
        channelProductId: "missing",
        channelType: "variant",
        createdAt: new Date(),
        wmsProduct: { id: "wms1", sku: "PROD-A", name: "Product A" },
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);

    const result = await proposeMigrationCandidates();

    expect(result.summary.skippedRows).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it("increments noSkuMatchRows when normalized SKU has no match", async () => {
    prismaMock.productChannelMapping.findMany.mockResolvedValue([
      {
        id: "pcm1",
        wmsProductId: "wms1",
        channel: "shopee",
        channelProductId: "cp1",
        channelType: "variant",
        createdAt: new Date(),
        wmsProduct: { id: "wms1", sku: "NO-MATCH", name: "Product" },
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      {
        id: "cp1",
        shopId: "shop1",
        shopeeItemId: 999,
        itemSku: "UNKNOWN-SKU",
        variants: [{ id: "v1", modelId: 888, modelSku: "UNKNOWN-SKU" }],
      },
    ]);

    const result = await proposeMigrationCandidates();

    expect(result.summary.noSkuMatchRows).toBe(1);
    expect(result.candidates[0]?.proposedSalesSkuId).toBeNull();
    expect(result.candidates[0]?.confidence).toBe("legacy-migration-no-sku");
  });
});
