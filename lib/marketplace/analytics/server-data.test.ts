import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(), accessibleMarketplaceShops: vi.fn(),
  shopFindMany: vi.fn(), orderFindMany: vi.fn(), getCache: vi.fn(), setCache: vi.fn(),
  getMarketplaceCapabilities: vi.fn(), getMarketplaceFinancialReadiness: vi.fn(),
  requireApiActor: vi.fn(), withRateLimit: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ prisma: {
  shopeeShop: { findMany: mocks.shopFindMany }, shopeeOrder: { findMany: mocks.orderFindMany },
} }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds, marketplaceCacheScope: () => "test-owner" }));
vi.mock("@/lib/marketplace/shops", () => ({ accessibleMarketplaceShops: mocks.accessibleMarketplaceShops }));
vi.mock("@/lib/cache/cache-utils", () => ({ getCache: mocks.getCache, setCache: mocks.setCache }));
vi.mock("./capabilities", () => ({ getMarketplaceCapabilities: mocks.getMarketplaceCapabilities, getMarketplaceFinancialReadiness: mocks.getMarketplaceFinancialReadiness }));
vi.mock("@/lib/auth/require-api-scope", () => ({ requireApiActor: mocks.requireApiActor, ApiScopeError: class extends Error {} }));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("./legacy", () => ({ legacyMarketplaceStatsResponse: vi.fn(), legacyMarketplaceMetricResponse: vi.fn() }));

import { getMarketplaceAnalytics } from "./server";
import { marketplaceStatsResponse } from "./http";

const user = { id: "owner-1", role: "admin" };
const shop = { id: "shop-1", lastSyncedAt: "2026-10-18T12:00:00.000Z", region: "MY" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue([user.id]);
  mocks.accessibleMarketplaceShops.mockResolvedValue([shop]);
  mocks.shopFindMany.mockResolvedValue([{ id: shop.id }]);
  mocks.orderFindMany.mockResolvedValue([{
    id: "order-1", shopId: shop.id, currency: "MYR", orderStatus: "READY_TO_SHIP", totalAmount: 20,
    shopeeCreatedAt: new Date("2026-10-17T17:00:00Z"), createdAt: new Date("2026-10-18T12:00:00Z"),
    sourceObservedAt: new Date("2026-10-18T12:00:00Z"), buyerUsername: null, buyerEmail: null,
    financialQuality: "unknown", commissionFee: null, serviceFee: null, sellerTxnFee: null,
    shippingFee: null, sellerIncome: null, items: [],
  }]);
  mocks.getCache.mockResolvedValue(null);
  mocks.getMarketplaceCapabilities.mockResolvedValue({ orders: "unknown", finance: "unknown" });
  mocks.getMarketplaceFinancialReadiness.mockResolvedValue(false);
  mocks.requireApiActor.mockResolvedValue({ user, authType: "session" });
  mocks.withRateLimit.mockResolvedValue(null);
});

describe("analytics source dates and freshness", () => {
  it("uses explicit source-date boundaries and exposes persisted observation metadata through HTTP", async () => {
    const params = new URLSearchParams({ shopId: shop.id, dateFrom: "2026-10-18T00:00:00+08:00", dateTo: "2026-10-18T23:59:59.999+08:00" });
    const response = await marketplaceStatsResponse(new NextRequest(`http://localhost/api/v1/marketplaces/shopee/analytics/summary?${params}`), "shopee");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ totalOrders: 1, operationalSales: 20 });
    expect(body.freshness).toMatchObject({
      source: "local", historyCompleteness: "unknown", latestMatchingOrderObservedAt: "2026-10-18T12:00:00.000Z",
      shops: [{ shopId: shop.id, lastShopSyncAt: shop.lastSyncedAt }],
    });
    expect(Number.isFinite(Date.parse(body.freshness.computedAt))).toBe(true);
    expect(body.filters.dateFrom).toBe(params.get("dateFrom"));
    const range = { gte: new Date("2026-10-17T16:00:00Z"), lte: new Date("2026-10-18T15:59:59.999Z") };
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      shopId: { in: [shop.id] }, OR: [{ shopeeCreatedAt: range }, { shopeeCreatedAt: null, createdAt: range }],
    } }));
    expect(mocks.setCache).toHaveBeenCalledWith(expect.stringContaining("freshness-v1"), expect.objectContaining({ freshness: body.freshness }), 120);
  });

  it("warns about empty local data and unknown sync time without claiming zero live sales", async () => {
    mocks.accessibleMarketplaceShops.mockResolvedValue([{ ...shop, lastSyncedAt: null }]);
    mocks.orderFindMany.mockResolvedValue([]);
    const response = await marketplaceStatsResponse(new NextRequest("http://localhost/api/v1/marketplaces/shopee/analytics/summary"), "shopee");
    const body = await response.json();
    expect(body.freshness).toMatchObject({ latestMatchingOrderObservedAt: null, historyCompleteness: "unknown", shops: [{ shopId: shop.id, lastShopSyncAt: null }] });
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("does not establish zero live orders"),
      expect.stringContaining("no recorded synchronization time"),
    ]));
    expect(body.data.operationalSales).toBeNull();
  });

  it("retains the original computation time on cache hits", async () => {
    const params = new URLSearchParams();
    const first = await getMarketplaceAnalytics("shopee", user, params);
    mocks.getCache.mockResolvedValue(first);
    const cached = await getMarketplaceAnalytics("shopee", user, params);
    expect(cached.freshness).toEqual(first.freshness);
    expect(mocks.orderFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.setCache).toHaveBeenCalledTimes(1);
  });
});
