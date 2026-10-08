import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  claimed: vi.fn(),
  nextAttempt: vi.fn(),
  retry: vi.fn(),
  invalidateCache: vi.fn(),
  invalidateMarketplaceAnalytics: vi.fn(),
  shopeeShop: { findUnique: vi.fn() },
  lazadaShop: { findUnique: vi.fn() },
  tikTokShop: { findUnique: vi.fn() },
  shopifyShop: { findUnique: vi.fn() },
  syncShopeeOrders: vi.fn(), syncShopeeProducts: vi.fn(), syncShopeeReturns: vi.fn(), syncShopeeAds: vi.fn(), syncShopeePayoutStatements: vi.fn(), syncShopeeAll: vi.fn(),
  syncLazadaProducts: vi.fn(), syncLazadaOrders: vi.fn(), syncLazadaFinance: vi.fn(), syncLazadaPayoutStatements: vi.fn(), syncLazadaAll: vi.fn(),
  syncTikTokProducts: vi.fn(), syncTikTokOrders: vi.fn(), syncTikTokFinance: vi.fn(), syncTikTokPayoutStatements: vi.fn(), syncTikTokAll: vi.fn(),
  syncShopifyProducts: vi.fn(), syncShopifyOrders: vi.fn(), syncShopifyFinance: vi.fn(), syncShopifyAll: vi.fn(),
}));

vi.mock("@/lib/marketplace/sync-jobs", () => ({
  claimMarketplaceSyncJob: mocks.claim,
  completeMarketplaceSyncJob: mocks.complete,
  failMarketplaceSyncJob: mocks.fail,
  getClaimedMarketplaceSyncJob: mocks.claimed,
  getMarketplaceSyncJobNextAttempt: mocks.nextAttempt,
  retryMarketplaceSyncJob: mocks.retry,
}));
vi.mock("@/prisma/client", () => ({ prisma: {
  shopeeShop: mocks.shopeeShop,
  lazadaShop: mocks.lazadaShop,
  tikTokShop: mocks.tikTokShop,
  shopifyShop: mocks.shopifyShop,
} }));
vi.mock("@/lib/cache/cache-utils", () => ({
  cacheKeys: {
    shopee: { pattern: "shopee:*" }, lazada: { pattern: "lazada:*" }, tiktok: { pattern: "tiktok:*" }, shopify: { pattern: "shopify:*" },
  },
  invalidateCache: mocks.invalidateCache,
  invalidateMarketplaceAnalytics: mocks.invalidateMarketplaceAnalytics,
}));
vi.mock("@/lib/shopee", () => ({
  syncShopeeOrders: mocks.syncShopeeOrders, syncShopeeProducts: mocks.syncShopeeProducts, syncShopeeReturns: mocks.syncShopeeReturns,
  syncShopeeAds: mocks.syncShopeeAds, syncShopeePayoutStatements: mocks.syncShopeePayoutStatements, syncShopeeAll: mocks.syncShopeeAll,
}));
vi.mock("@/lib/lazada", () => ({
  syncLazadaProducts: mocks.syncLazadaProducts, syncLazadaOrders: mocks.syncLazadaOrders, syncLazadaFinance: mocks.syncLazadaFinance,
  syncLazadaPayoutStatements: mocks.syncLazadaPayoutStatements, syncLazadaAll: mocks.syncLazadaAll,
}));
vi.mock("@/lib/tiktok", () => ({
  syncTikTokProducts: mocks.syncTikTokProducts, syncTikTokOrders: mocks.syncTikTokOrders, syncTikTokFinance: mocks.syncTikTokFinance,
  syncTikTokPayoutStatements: mocks.syncTikTokPayoutStatements, syncTikTokAll: mocks.syncTikTokAll,
}));
vi.mock("@/lib/shopify", () => ({
  syncShopifyProducts: mocks.syncShopifyProducts, syncShopifyOrders: mocks.syncShopifyOrders,
  syncShopifyFinance: mocks.syncShopifyFinance, syncShopifyAll: mocks.syncShopifyAll,
}));

import { dispatchMarketplaceSyncJob } from "./sync-dispatch";

const now = new Date("2026-10-06T12:00:00.000Z");
const job = (overrides: Record<string, unknown> = {}) => ({
  id: "a".repeat(24), platform: "shopee", shopId: "b".repeat(24), syncType: "orders", requestedByUserId: "requester", input: { daysBack: 7 },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(true);
  mocks.complete.mockResolvedValue(true);
  mocks.claimed.mockResolvedValue(job());
  mocks.invalidateCache.mockResolvedValue(1);
  mocks.invalidateMarketplaceAnalytics.mockResolvedValue(undefined);
  mocks.syncShopeeOrders.mockResolvedValue({});
});

describe("dispatchMarketplaceSyncJob", () => {
  it("claims work, resolves the Shopee provider identifier from the internal shop id, invalidates caches, and completes", async () => {
    mocks.shopeeShop.findUnique.mockResolvedValue({ shopId: 123, userId: "shop-owner" });

    await expect(dispatchMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "completed" });

    expect(mocks.claim).toHaveBeenCalledWith("a".repeat(24), "worker-a", now, 15 * 60 * 1000);
    expect(mocks.shopeeShop.findUnique).toHaveBeenCalledWith({ where: { id: "b".repeat(24) }, select: { shopId: true, userId: true } });
    expect(mocks.syncShopeeOrders).toHaveBeenCalledWith(123, "shop-owner", expect.any(Number), expect.any(Number), "requester");
    expect(mocks.invalidateCache).toHaveBeenCalledWith("shopee:*");
    expect(mocks.invalidateMarketplaceAnalytics).toHaveBeenCalledWith("shopee");
    expect(mocks.complete).toHaveBeenCalledWith("a".repeat(24), "worker-a");
  });

  it.each([
    ["lazada", "finance", "lazadaShop", { sellerId: "seller-9", userId: "owner-l" }, "syncLazadaFinance", ["seller-9", "owner-l", expect.any(String), "requester"]],
    ["tiktok", "payouts", "tikTokShop", { shopId: "provider-t", userId: "owner-t" }, "syncTikTokPayoutStatements", ["provider-t", "owner-t", "requester"]],
    ["shopify", "products", "shopifyShop", { id: "b".repeat(24), userId: "owner-s" }, "syncShopifyProducts", ["b".repeat(24), "owner-s", "requester"]],
  ] as const)("uses %s's record context for %s", async (platform, syncType, shopModel, shop, syncFunction, args) => {
    mocks.claimed.mockResolvedValue(job({ platform, syncType }));
    mocks[shopModel].findUnique.mockResolvedValue(shop);
    mocks[syncFunction].mockResolvedValue({});

    await expect(dispatchMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "completed" });

    expect(mocks[syncFunction]).toHaveBeenCalledWith(...args);
    expect(mocks.invalidateCache).toHaveBeenCalledWith(`${platform}:*`);
  });

  it("does nothing when another worker holds the lease", async () => {
    mocks.claim.mockResolvedValue(false);
    await expect(dispatchMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "skipped" });
    expect(mocks.claimed).not.toHaveBeenCalled();
    expect(mocks.syncShopeeOrders).not.toHaveBeenCalled();
  });

  it("retries provider failures with only a stable code and never exposes the provider message", async () => {
    mocks.shopeeShop.findUnique.mockResolvedValue({ shopId: 123, userId: "shop-owner" });
    mocks.syncShopeeOrders.mockRejectedValue(new Error("token=secret-from-provider"));
    mocks.retry.mockResolvedValue(true);
    mocks.nextAttempt.mockResolvedValue({ nextAttemptAt: new Date("2026-10-06T12:01:00.000Z") });

    await expect(dispatchMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "retrying", nextAttemptAt: new Date("2026-10-06T12:01:00.000Z") });

    expect(mocks.retry).toHaveBeenCalledWith("a".repeat(24), "worker-a", "SYNC_ATTEMPT_FAILED");
    expect(JSON.stringify(mocks.retry.mock.calls)).not.toContain("secret-from-provider");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("fails unsupported work without repeatedly calling a provider", async () => {
    mocks.claimed.mockResolvedValue(job({ platform: "shopify", syncType: "returns" }));
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "b".repeat(24), userId: "owner-s" });

    await expect(dispatchMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "failed" });

    expect(mocks.fail).toHaveBeenCalledWith("a".repeat(24), "worker-a", "SYNC_TYPE_UNSUPPORTED");
    expect(mocks.syncShopifyProducts).not.toHaveBeenCalled();
  });
});
