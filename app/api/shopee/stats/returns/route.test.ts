import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  withRateLimit: vi.fn(),
  marketplaceOwnerIds: vi.fn(),
  marketplaceCacheScope: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
  legacyFinancialReady: vi.fn(),
  shopeeShopFindMany: vi.fn(),
  shopeeOrderCount: vi.fn(),
  shopeeReturnCount: vi.fn(),
  shopeeReturnGroupBy: vi.fn(),
  shopeeReturnFindMany: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock("@/prisma/client", () => ({
  prisma: {
    shopeeShop: { findMany: mocks.shopeeShopFindMany },
    shopeeOrder: { count: mocks.shopeeOrderCount },
    shopeeReturn: { count: mocks.shopeeReturnCount, groupBy: mocks.shopeeReturnGroupBy, findMany: mocks.shopeeReturnFindMany },
  },
}));
vi.mock("@/lib/cache/cache-utils", () => ({ getCache: mocks.getCache, setCache: mocks.setCache }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/api/rate-limit", () => ({ defaultRateLimits: { standard: {} }, withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceCacheScope: mocks.marketplaceCacheScope, marketplaceOwnerIds: mocks.marketplaceOwnerIds }));
vi.mock("@/lib/marketplace/analytics/legacy-quality", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketplace/analytics/legacy-quality")>(),
  legacyFinancialReady: mocks.legacyFinancialReady,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.getSessionFromRequest.mockResolvedValue({ id: "owner-1" });
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
  mocks.marketplaceCacheScope.mockReturnValue("owner-1");
  mocks.getCache.mockResolvedValue(null);
  mocks.setCache.mockResolvedValue(undefined);
  mocks.legacyFinancialReady.mockResolvedValue(true);
  mocks.shopeeShopFindMany.mockResolvedValue([{ id: "shop-1" }]);
  mocks.shopeeOrderCount.mockResolvedValue(1);
  mocks.shopeeReturnCount.mockResolvedValue(1);
  mocks.shopeeReturnGroupBy.mockResolvedValue([]);
  mocks.shopeeReturnFindMany
    .mockResolvedValueOnce([{ refundAmount: 0, financialQuality: "legacy-unverified" }])
    .mockResolvedValueOnce([{
      id: "return-1",
      returnSn: "return-sn-1",
      orderSn: "order-sn-1",
      status: "COMPLETED",
      refundAmount: 0,
      reason: "DAMAGED",
      buyerUsername: "buyer-1",
      shopeeCreatedAt: new Date("2026-01-01"),
      financialQuality: "legacy-unverified",
    }]);
});

describe("Shopee recent returns", () => {
  it("does not expose an uncertified defaulted refund zero and keeps provenance internal", async () => {
    const response = await GET(new NextRequest("http://localhost/api/shopee/stats/returns"));
    const body = await response.json();

    expect(body.recentReturns).toEqual([expect.objectContaining({ refundAmount: null })]);
    expect(body.recentReturns[0]).not.toHaveProperty("buyerUsername");
    expect(body.recentReturns[0]).not.toHaveProperty("financialQuality");
  });

  it("retains a certified explicit refund zero", async () => {
    mocks.shopeeReturnFindMany.mockReset();
    mocks.shopeeReturnFindMany
      .mockResolvedValueOnce([{ refundAmount: 0, financialQuality: "verified" }])
      .mockResolvedValueOnce([{
        id: "return-1",
        returnSn: "return-sn-1",
        orderSn: "order-sn-1",
        status: "COMPLETED",
        refundAmount: 0,
        reason: "DAMAGED",
        buyerUsername: "buyer-1",
        shopeeCreatedAt: new Date("2026-01-01"),
        financialQuality: "verified",
      }]);

    const response = await GET(new NextRequest("http://localhost/api/shopee/stats/returns"));
    const body = await response.json();

    expect(body.recentReturns[0]).toMatchObject({ refundAmount: 0 });
  });
});
