import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    product: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
    productReview: { groupBy: vi.fn() },
    category: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    productChannelMapping: { groupBy: vi.fn() },
    wmsProductSalesFact: { findMany: vi.fn() },
    marketplaceSkuMapping: { findMany: vi.fn() },
  },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { getProductPerformance } from "./product-performance-data";

const product = {
  id: "product-1", name: "New item", sku: "NEW-1", quantity: 10, reservedQuantity: 0,
  status: "active", categoryId: null, supplierId: null, createdAt: new Date("2026-01-29T00:00:00.000Z"), channelMappings: [],
};

describe("getProductPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([product]);
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.orderItem.findMany.mockResolvedValue([]);
    prismaMock.productReview.groupBy.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.supplier.findMany.mockResolvedValue([]);
    prismaMock.productChannelMapping.groupBy.mockResolvedValue([]);
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
  });

  it("does not classify a newly listed zero-sale product as excess", async () => {
    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ recommendation: "needs-data", confidence: "needs-data", coverage: "3 observed days; at least 7 are required" });
  });

  it("queries WMS orders through the normalized selected end day", async () => {
    const end = new Date("2026-01-31T23:59:59.999Z");
    const orderDate = new Date("2026-01-30T00:00:00.000Z");
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: orderDate }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 2, subtotal: 20, orderId: "order-1" }]);
    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), end);

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: end } }),
    }));
    expect(prismaMock.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: { in: ["order-1"] } }),
    }));
    expect(data.products[0]?.unitsSold).toBe(2);
  });

  it("includes workspace products for the shared admin scope and sales from their creators", async () => {
    await getProductPerformance("admin-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"), { ownerIds: ["admin-1"], sharedAdmin: true });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: [{ userId: { in: ["admin-1"] }, workspaceId: null }, { workspaceId: { not: null } }] })]) }),
    }));
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ userId: expect.anything() }),
    }));
  });

  it("filters orders by userId in single-tenant mode (no dataScope)", async () => {
    await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: { in: ["owner-1"] } }),
    }));
  });

  it("reports both WMS sales and marketplace facts when both exist", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    const orderDate = new Date("2026-01-30T00:00:00.000Z");
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: orderDate }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 5, subtotal: 50, orderId: "order-1" }]);
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      { wmsProductId: "product-1", normalizedUnits: 3, allocatedGmvMinor: "3000", currency: "PHP", amountScale: 2, mappingId: "mapping-1", sourceLine: { offerId: "offer-1" } },
      { wmsProductId: "product-1", normalizedUnits: 2, allocatedGmvMinor: "2000", currency: "PHP", amountScale: 2, mappingId: "mapping-1", sourceLine: { offerId: "offer-1" } },
    ]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-1", salesSkuId: "sku-1", salesSku: { id: "sku-1", code: "SSKU-1", name: "Sales SKU 1" } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-1", offerKey: "offer-1" }, { salesSkuId: "sku-1", offerKey: "offer-x" }]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(row.unitsSold).toBe(5);
    expect(row.marketplaceNormalizedUnits).toBe(5);
    expect(row.marketplaceRevenue).toEqual({ PHP: { minor: 5000, scale: 2 } });
    expect(row.contributingSalesSkus).toEqual([{ id: "sku-1", code: "SSKU-1", name: "Sales SKU 1", units: 5 }]);
    expect(row.marketplaceCoverage).toEqual({ mappedOffers: 1, totalOffers: 2, mappingPercent: 50 });
  });

  it("returns marketplace fields as null when no facts exist", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    const orderDate = new Date("2026-01-30T00:00:00.000Z");
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: orderDate }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 5, subtotal: 50, orderId: "order-1" }]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(row.unitsSold).toBe(5);
    expect(row.marketplaceNormalizedUnits).toBeNull();
    expect(row.marketplaceRevenue).toBeNull();
    expect(row.marketplaceCoverage).toBeNull();
    expect(row.contributingSalesSkus).toBeNull();
  });

  it("reports marketplace facts with null WMS sales when only marketplace data exists", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      { wmsProductId: "product-1", normalizedUnits: 10, allocatedGmvMinor: "10000", currency: "USD", amountScale: 2, mappingId: "mapping-2", sourceLine: { offerId: "offer-2" } },
    ]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-2", salesSkuId: "sku-2", salesSku: { id: "sku-2", code: "SSKU-2", name: "Sales SKU 2" } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-2", offerKey: "offer-2" }]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(row.unitsSold).toBe(0);
    expect(row.marketplaceNormalizedUnits).toBe(10);
    expect(row.marketplaceRevenue).toEqual({ USD: { minor: 10000, scale: 2 } });
    expect(row.contributingSalesSkus).toEqual([{ id: "sku-2", code: "SSKU-2", name: "Sales SKU 2", units: 10 }]);
    expect(row.marketplaceCoverage).toEqual({ mappedOffers: 1, totalOffers: 1, mappingPercent: 100 });
  });

  it("calculates coverage accurately with multiple offers and SKUs", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      { wmsProductId: "product-1", normalizedUnits: 5, allocatedGmvMinor: "5000", currency: "PHP", amountScale: 2, mappingId: "mapping-a", sourceLine: { offerId: "offer-a" } },
      { wmsProductId: "product-1", normalizedUnits: 3, allocatedGmvMinor: "3000", currency: "PHP", amountScale: 2, mappingId: "mapping-b", sourceLine: { offerId: "offer-b" } },
    ]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([
        { id: "mapping-a", salesSkuId: "sku-a", salesSku: { id: "sku-a", code: "A", name: "SKU A" } },
        { id: "mapping-b", salesSkuId: "sku-b", salesSku: { id: "sku-b", code: "B", name: "SKU B" } },
      ])
      .mockResolvedValueOnce([
        { salesSkuId: "sku-a", offerKey: "offer-a1" },
        { salesSkuId: "sku-a", offerKey: "offer-a2" },
        { salesSkuId: "sku-a", offerKey: "offer-a3" },
        { salesSkuId: "sku-b", offerKey: "offer-b1" },
        { salesSkuId: "sku-b", offerKey: "offer-b2" },
      ]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(row.marketplaceCoverage).toEqual({ mappedOffers: 2, totalOffers: 5, mappingPercent: 40 });
    expect(row.reasons).toContain("low-marketplace-mapping-coverage");
  });

  it("warns on amountScale mismatch and uses first observed scale", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      { wmsProductId: "product-1", normalizedUnits: 3, allocatedGmvMinor: "3000", currency: "PHP", amountScale: 2, mappingId: "mapping-1", sourceLine: { offerId: "offer-1" } },
      { wmsProductId: "product-1", normalizedUnits: 2, allocatedGmvMinor: "200000", currency: "PHP", amountScale: 4, mappingId: "mapping-1", sourceLine: { offerId: "offer-1" } },
    ]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-1", salesSkuId: "sku-1", salesSku: { id: "sku-1", code: "SSKU-1", name: "Sales SKU 1" } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-1", offerKey: "offer-1" }]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("amountScale mismatch"));
    expect(row.marketplaceRevenue).toEqual({ PHP: { minor: 203000, scale: 2 } });
    warnSpy.mockRestore();
  });
});