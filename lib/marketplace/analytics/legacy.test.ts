import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMarketplaceCapabilities: vi.fn(),
  getMarketplaceFinancialReadiness: vi.fn(),
  shopeeShopFindMany: vi.fn(),
  shopeeOrderFindMany: vi.fn(),
  shopifyShopFindMany: vi.fn(),
  shopifyShopFindFirst: vi.fn(),
  shopifyProductCount: vi.fn(),
  shopifyOrderCount: vi.fn(),
  shopifyOrderGroupBy: vi.fn(),
  shopifyOrderAggregate: vi.fn(),
  shopifyOrderFindMany: vi.fn(),
  shopifyOrderItemFindMany: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({
  prisma: {
    shopeeShop: { findMany: mocks.shopeeShopFindMany },
    shopeeOrder: { findMany: mocks.shopeeOrderFindMany },
    shopifyShop: { findMany: mocks.shopifyShopFindMany, findFirst: mocks.shopifyShopFindFirst },
    shopifyProduct: { count: mocks.shopifyProductCount },
    shopifyOrder: { count: mocks.shopifyOrderCount, groupBy: mocks.shopifyOrderGroupBy, aggregate: mocks.shopifyOrderAggregate, findMany: mocks.shopifyOrderFindMany },
    shopifyOrderItem: { findMany: mocks.shopifyOrderItemFindMany },
  },
}));
vi.mock("./capabilities", () => ({
  getMarketplaceCapabilities: mocks.getMarketplaceCapabilities,
  getMarketplaceFinancialReadiness: mocks.getMarketplaceFinancialReadiness,
}));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: vi.fn() }));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: vi.fn() }));
vi.mock("@/lib/api/rate-limit", () => ({ defaultRateLimits: { standard: {} }, withRateLimit: vi.fn() }));

import { legacyClv, shopifyStats } from "./legacy";

const capabilities = { orders: "available", finance: "available", refunds: "available", settlements: "available", buyerIdentity: "available" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getMarketplaceCapabilities.mockResolvedValue(capabilities);
  mocks.getMarketplaceFinancialReadiness.mockResolvedValue(true);
});

describe("legacy Shopee CLV containment", () => {
  it("does not aggregate a defaulted legacy zero into monetary or CLV output", async () => {
    mocks.shopeeShopFindMany.mockResolvedValue([{ id: "shop-1" }]);
    mocks.shopeeOrderFindMany.mockResolvedValue([
      { buyerUsername: "buyer-1", totalAmount: 0, financialQuality: "legacy-unverified", shopeeCreatedAt: new Date("2026-01-01") },
    ]);

    const result = await legacyClv(["owner-1"], new URLSearchParams());

    expect(result.summary.avgMonetary).toBeNull();
    expect(result.summary.avgClv).toBeNull();
    expect(result.topBuyersByClv).toEqual([]);
  });

  it("retains a certified zero total", async () => {
    mocks.shopeeShopFindMany.mockResolvedValue([{ id: "shop-1" }]);
    mocks.shopeeOrderFindMany.mockResolvedValue([
      { buyerUsername: "buyer-1", totalAmount: 0, financialQuality: "verified", shopeeCreatedAt: new Date() },
    ]);

    const result = await legacyClv(["owner-1"], new URLSearchParams());

    expect(result.summary.avgMonetary).toBe(0);
    expect(result.topBuyersByClv[0]).toMatchObject({ totalSpent: 0, avgOrderValue: 0 });
  });
});

describe("legacy Shopify product revenue", () => {
  it("includes legacy orders without completeness state in order-level revenue and counts", async () => {
    mocks.shopifyShopFindMany.mockResolvedValue([{ id: "shop-1" }]);
    mocks.shopifyProductCount.mockResolvedValue(2);
    mocks.shopifyOrderCount.mockResolvedValue(2);
    mocks.shopifyOrderGroupBy.mockResolvedValue([]);
    mocks.shopifyOrderAggregate.mockResolvedValue({ _sum: { totalAmount: 36 }, _avg: { totalAmount: 18 } });
    mocks.shopifyOrderFindMany.mockResolvedValue([{ totalAmount: 36, financialQuality: "verified" }]);
    mocks.shopifyOrderItemFindMany.mockResolvedValue([
      { name: "Known product", price: 12, quantity: 3, order: { financialQuality: "verified" } },
      { name: "Unknown product", price: 0, quantity: 2, order: { financialQuality: "legacy-unverified" } },
    ]);
    mocks.shopifyShopFindFirst.mockResolvedValue({ lastSyncedAt: null });

    const result = await shopifyStats(["owner-1"], new URLSearchParams());

    expect(result).toMatchObject({ totalOrders: 2, totalRevenue: 36 });
    expect(result.topProducts).toEqual(expect.arrayContaining([
      { name: "Known product", revenue: 36, quantity: 3 },
      { name: "Unknown product", revenue: null, quantity: null },
    ]));
    expect(mocks.shopifyOrderCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ isLineItemsComplete: true }),
    }));
    expect(mocks.shopifyOrderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ isLineItemsComplete: true }),
    }));
    expect(mocks.shopifyOrderItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order: expect.not.objectContaining({ isLineItemsComplete: true }) },
    }));
  });
});
