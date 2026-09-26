import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    product: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
    productReview: { groupBy: vi.fn() },
    category: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    wmsProductSalesFact: { findMany: vi.fn() },
    marketplaceSkuMapping: { findMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    purchaseOrderItem: { findMany: vi.fn() },
    shopeeOrderItem: { count: vi.fn() },
  },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { getProductPerformance } from "./product-performance-data";

const product = {
  id: "product-1",
  name: "Product one",
  sku: "SKU-1",
  quantity: 10,
  reservedQuantity: 0,
  status: "active",
  categoryId: "category-1",
  supplierId: "supplier-1",
  createdAt: new Date("2025-12-01T00:00:00.000Z"),
};

const marketplaceFact = (overrides: Record<string, unknown> = {}) => ({
  wmsProductId: "product-1",
  normalizedUnits: 5,
  allocatedGmvMinor: "5000",
  currency: "PHP",
  amountScale: 2,
  mappingId: "mapping-1",
  saleDate: new Date("2026-01-30T00:00:00.000Z"),
  sourceLine: { offerId: "offer-1", platform: "shopee", marketplaceQuantity: 1, orderEligibility: "eligible" },
  ...overrides,
});

describe("getProductPerformance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:59:59.999Z"));
    vi.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([product]);
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.orderItem.findMany.mockResolvedValue([]);
    prismaMock.productReview.groupBy.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([{ id: "category-1", name: "Category" }]);
    prismaMock.supplier.findMany.mockResolvedValue([{ id: "supplier-1", leadTimeDays: 14 }]);
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([]);
    prismaMock.shopeeOrderItem.count.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not classify a newly listed zero-sale product as dormant", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...product, createdAt: new Date("2026-01-29T00:00:00.000Z") }]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ recommendation: "data-issue", confidence: "needs-data", coverage: "3 observed days; at least 7 are required" });
  });

  it("uses only qualified WMS orders and combines WMS and marketplace component demand", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: new Date("2026-01-30T00:00:00.000Z") }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 5, subtotal: 50, orderId: "order-1" }]);
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([marketplaceFact()]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-1", salesSkuId: "sku-1", salesSku: { id: "sku-1", code: "SSKU-1", name: "100 x SKU-1", isKit: true } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-1", offerKey: "offer-1" }, { salesSkuId: "sku-1", offerKey: "offer-2" }]);

    const data = await getProductPerformance("owner-1", from, to);
    const row = data.products[0]!;

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["confirmed", "processing", "shipped", "delivered"] }, createdAt: { gte: from, lte: to } }),
    }));
    expect(row.unitsSold).toBe(5);
    expect(row.marketplaceNormalizedUnits).toBe(5);
    expect(row.totalNormalizedUnits).toBe(10);
    expect(row.dailyVelocity).toBeCloseTo(10 / 31);
    expect(row.channelDemand).toEqual({ shopee: { normalizedUnits: 5, marketplaceUnits: 1 } });
    expect(row.marketplaceRevenue).toEqual({ PHP: { minor: 5000, scale: 2 } });
    expect(row.marketplaceCoverage).toEqual({ observedOffers: 1, linkedOffers: 2, activityPercent: 50 });
    expect(row.contributingSalesSkus).toEqual([{
      id: "sku-1",
      code: "SSKU-1",
      name: "100 x SKU-1",
      isKit: true,
      normalizedUnits: 5,
      marketplaceUnits: 1,
      unitsPerSale: 5,
      componentSupportedQuantity: 2,
      channels: ["shopee"],
    }]);
  });

  it("includes only unreceived quantities from ordered or shipping purchase orders", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...product, quantity: 2 }]);
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: new Date("2026-01-30T00:00:00.000Z") }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 30, subtotal: 300, orderId: "order-1" }]);
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ id: "po-1", estimatedDelivery: new Date("2026-02-01T00:00:00.000Z") }]);
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([{ productId: "product-1", purchaseOrderId: "po-1", quantity: 25, quantityReceived: 5 }]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));
    const row = data.products[0]!;

    expect(prismaMock.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["ordered", "shipping"] } }) }));
    expect(row).toMatchObject({ inboundQuantity: 20, inventoryPosition: 22, recommendation: "watch", suggestedQuantity: 0 });
    expect(row.nextInboundDate).toBe("2026-02-01T00:00:00.000Z");
  });

  it("does not let a later receipt borrow the ETA of an earlier receipt", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...product, quantity: 2 }]);
    prismaMock.order.findMany.mockResolvedValue([{ id: "order-1", createdAt: new Date("2026-01-30T00:00:00.000Z") }]);
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 30, subtotal: 300, orderId: "order-1" }]);
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { id: "po-early", estimatedDelivery: new Date("2026-02-01T00:00:00.000Z") },
      { id: "po-late", estimatedDelivery: new Date("2026-03-01T00:00:00.000Z") },
    ]);
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { productId: "product-1", purchaseOrderId: "po-early", quantity: 1, quantityReceived: 0 },
      { productId: "product-1", purchaseOrderId: "po-late", quantity: 100, quantityReceived: 0 },
    ]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ inboundQuantity: 101, recommendation: "critical" });
    expect(new Date(data.products[0]!.projectedStockoutDate!).getTime()).toBeLessThan(new Date("2026-03-01T00:00:00.000Z").getTime());
  });

  it("lets marketplace-only normalized demand drive the recommendation", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...product, quantity: 0 }]);
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([marketplaceFact({ normalizedUnits: 100 })]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-1", salesSkuId: "sku-1", salesSku: { id: "sku-1", code: "SSKU-1", name: "Sales SKU", isKit: true } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-1", offerKey: "offer-1" }]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ unitsSold: 0, totalNormalizedUnits: 100, recommendation: "critical" });
  });

  it("ignores stale marketplace facts whose source order is no longer eligible", async () => {
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      marketplaceFact({ sourceLine: { offerId: "offer-1", platform: "shopee", marketplaceQuantity: 1, orderEligibility: "ineligible" } }),
    ]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ totalNormalizedUnits: 0, marketplaceNormalizedUnits: null, recommendation: "dormant" });
  });

  it("returns marketplace fields as null when no marketplace facts exist", async () => {
    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));
    const row = data.products[0]!;

    expect(row.marketplaceNormalizedUnits).toBeNull();
    expect(row.marketplaceRevenue).toBeNull();
    expect(row.marketplaceCoverage).toBeNull();
    expect(row.channelDemand).toBeNull();
    expect(row.contributingSalesSkus).toBeNull();
  });

  it("classifies active products with no reliable demand or stock as not stocked", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...product, quantity: 0 }]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ recommendation: "not-stocked", reasons: ["no-demand-and-no-stock"] });
    expect(data.summary).toMatchObject({ healthy: 0, "not-stocked": 1, action: 0 });
  });

  it("warns when raw Shopee sales have not been projected into component facts", async () => {
    prismaMock.shopeeOrderItem.count.mockResolvedValue(12);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.attribution).toEqual({ rawShopeeOrderItems: 12, normalizedComponentFacts: 0, state: "unprojected" });
  });

  it("returns only the requested action-queue page while keeping the total", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      product,
      { ...product, id: "product-2", name: "Product two", sku: "SKU-2" },
    ]);

    const data = await getProductPerformance(
      "owner-1",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-31T23:59:59.999Z"),
      undefined,
      { view: "action", page: 1, pageSize: 1 },
    );

    expect(data.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(data.products).toHaveLength(1);
    expect(data.products[0]!.id).toBe("product-2");
  });

  it("filters before calculating pagination", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      product,
      { ...product, id: "product-2", name: "Product two", sku: "SKU-2" },
    ]);

    const data = await getProductPerformance(
      "owner-1",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-31T23:59:59.999Z"),
      undefined,
      { view: "action", search: "two", page: 0, pageSize: 1 },
    );

    expect(data.pagination).toEqual({ page: 0, pageSize: 1, total: 1, totalPages: 1 });
    expect(data.products[0]!.id).toBe("product-2");
  });

  it("includes workspace products, sales, and inbound supply for shared admins", async () => {
    await getProductPerformance("admin-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"), { ownerIds: ["admin-1"], sharedAdmin: true });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: [{ userId: { in: ["admin-1"] }, workspaceId: null }, { workspaceId: { not: null } }] })]) }),
    }));
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ userId: expect.anything() }) }));
    expect(prismaMock.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ userId: { in: ["admin-1"] }, workspaceId: null }, { workspaceId: { not: null } }] }),
    }));
  });

  it("warns on amount scale mismatch and preserves the first observed scale", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.wmsProductSalesFact.findMany.mockResolvedValue([
      marketplaceFact({ normalizedUnits: 3, allocatedGmvMinor: "3000" }),
      marketplaceFact({ normalizedUnits: 2, allocatedGmvMinor: "200000", amountScale: 4 }),
    ]);
    prismaMock.marketplaceSkuMapping.findMany
      .mockResolvedValueOnce([{ id: "mapping-1", salesSkuId: "sku-1", salesSku: { id: "sku-1", code: "SSKU-1", name: "Sales SKU", isKit: false } }])
      .mockResolvedValueOnce([{ salesSkuId: "sku-1", offerKey: "offer-1" }]);

    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("amountScale mismatch"));
    expect(data.products[0]!.marketplaceRevenue).toEqual({ PHP: { minor: 203000, scale: 2 } });
    warnSpy.mockRestore();
  });
});
