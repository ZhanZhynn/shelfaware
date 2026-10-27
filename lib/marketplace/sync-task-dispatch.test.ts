import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpoint: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), claimed: vi.fn(), renew: vi.fn(), retry: vi.fn(),
  invalidateCache: vi.fn(), invalidateMarketplaceAnalytics: vi.fn(),
  shopeeShop: { findUnique: vi.fn() },
  lazadaShop: { findUnique: vi.fn() },
  tikTokShop: { findUnique: vi.fn() }, shopifyShop: { findUnique: vi.fn() },
  syncLazadaOrders: vi.fn(), syncLazadaFinance: vi.fn(), syncLazadaPayoutStatements: vi.fn(), syncLazadaProducts: vi.fn(),
  syncShopeeOrders: vi.fn(), syncShopeeProducts: vi.fn(), syncShopeeAds: vi.fn(), syncShopeeReturns: vi.fn(), syncShopeePayoutStatements: vi.fn(),
  syncTikTokOrders: vi.fn(), syncTikTokFinance: vi.fn(), syncTikTokProducts: vi.fn(),
  syncShopifyOrders: vi.fn(), syncShopifyFinance: vi.fn(), syncShopifyProducts: vi.fn(),
  reviewPage: vi.fn(), slaPage: vi.fn(),
}));

vi.mock("./sync-runs", () => ({
  checkpointMarketplaceSyncTask: mocks.checkpoint,
  claimMarketplaceSyncTask: mocks.claim,
  completeMarketplaceSyncTask: mocks.complete,
  failMarketplaceSyncTask: mocks.fail,
  getClaimedMarketplaceSyncTask: mocks.claimed,
  renewMarketplaceSyncTaskLease: mocks.renew,
  retryMarketplaceSyncTask: mocks.retry,
}));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: mocks.shopeeShop, lazadaShop: mocks.lazadaShop, tikTokShop: mocks.tikTokShop, shopifyShop: mocks.shopifyShop } }));
vi.mock("@/lib/cache/cache-utils", () => ({
  cacheKeys: { shopee: { pattern: "shopee:*" }, lazada: { pattern: "lazada:*" }, tiktok: { pattern: "tiktok:*" }, shopify: { pattern: "shopify:*" } },
  invalidateCache: mocks.invalidateCache,
  invalidateMarketplaceAnalytics: mocks.invalidateMarketplaceAnalytics,
}));
vi.mock("@/lib/shopee", () => ({ syncShopeeOrders: mocks.syncShopeeOrders, syncShopeeProducts: mocks.syncShopeeProducts, syncShopeeAds: mocks.syncShopeeAds, syncShopeeReturns: mocks.syncShopeeReturns, syncShopeePayoutStatements: mocks.syncShopeePayoutStatements }));
vi.mock("@/lib/lazada", () => ({ syncLazadaOrders: mocks.syncLazadaOrders, syncLazadaFinance: mocks.syncLazadaFinance, syncLazadaPayoutStatements: mocks.syncLazadaPayoutStatements, syncLazadaProducts: mocks.syncLazadaProducts }));
vi.mock("@/lib/tiktok", () => ({ syncTikTokOrders: mocks.syncTikTokOrders, syncTikTokFinance: mocks.syncTikTokFinance, syncTikTokProducts: mocks.syncTikTokProducts, syncTikTokAll: vi.fn(), syncTikTokPayoutStatements: vi.fn() }));
vi.mock("@/lib/shopify", () => ({ syncShopifyOrders: mocks.syncShopifyOrders, syncShopifyFinance: mocks.syncShopifyFinance, syncShopifyProducts: mocks.syncShopifyProducts, syncShopifyAll: vi.fn() }));
vi.mock("@/lib/shopee/reviews-sync", () => ({ syncShopeeReviewPage: mocks.reviewPage }));
vi.mock("./sla/sync", () => ({ syncMarketplaceSlaPage: mocks.slaPage }));

import { dispatchMarketplaceSyncTask } from "./sync-task-dispatch";
import { LazadaProviderError } from "@/lib/lazada/provider-error";
import { TikTokProviderError } from "@/lib/tiktok/provider-error";
import { ShopifyProviderError } from "@/lib/shopify/provider-error";
import { ShopeeReviewError } from "@/lib/shopee/reviews-domain";

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "a".repeat(24), platform: "shopee", shopId: "b".repeat(24), stream: "orders_and_escrow", sequence: 0,
  run: { syncType: "all", requestedByUserId: "requester" },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(true);
  mocks.claimed.mockResolvedValue(task());
  mocks.renew.mockResolvedValue(true);
  mocks.complete.mockResolvedValue({ settled: true, nextTaskId: "c".repeat(24) });
  mocks.checkpoint.mockResolvedValue({ settled: true });
  mocks.shopeeShop.findUnique.mockResolvedValue({ shopId: 123, userId: "shop-owner" });
  mocks.syncShopeeOrders.mockResolvedValue({ synced: 1, created: 0, updated: 0, errors: [] });
  mocks.syncShopeeReturns.mockResolvedValue({ synced: 1, created: 0, updated: 0, errors: [] });
  mocks.syncShopeePayoutStatements.mockResolvedValue({ synced: 1, created: 0, updated: 0, errors: [] });
  mocks.invalidateCache.mockResolvedValue(undefined);
  mocks.invalidateMarketplaceAnalytics.mockResolvedValue(undefined);
});

describe("dispatchMarketplaceSyncTask", () => {
  it("checkpoints SLA backlog pages without applying all-run order-date bounds", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "sla", run: { syncType: "all", requestedByUserId: "actor", input: { dateFrom: "2026-10-01T00:00:00Z", dateTo: "2026-10-02T00:00:00Z" } } }));
    const checkpoint = { v: 1, phase: "discover", cursor: { queue: 1, cursor: "next", seen: [] }, pages: 1, records: 5, limited: false };
    mocks.slaPage.mockResolvedValue({ checkpoint, done: false, metrics: { pagesObserved: 1, unitsObserved: 5 } });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "checkpointed", nextTaskId: "task" });
    expect(mocks.slaPage).toHaveBeenCalledWith("shopee", "b".repeat(24), "actor", undefined, undefined, "run", { taskId: "task", workerId: "worker" });
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ checkpoint, dedupeKey: "sla-page-1" }));
    expect(mocks.syncShopeeOrders).not.toHaveBeenCalled();
  });

  it("does not complete a provider-limited SLA refresh or continue after losing its lease", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "sla", run: { syncType: "sla", requestedByUserId: "actor" } }));
    mocks.slaPage.mockResolvedValue({ checkpoint: { pages: 5, limited: true }, done: true, metrics: {} });
    mocks.fail.mockResolvedValue({ settled: true });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "failed" });
    expect(mocks.fail).toHaveBeenCalledWith("task", "worker", "SLA_PROVIDER_LIMIT");
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.renew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "skipped" });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("checkpoints one review page and ignores order date bounds in all-runs", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "reviews", run: { syncType: "all", requestedByUserId: "actor", input: { dateFrom: "2026-09-01T00:00:00Z", dateTo: "2026-09-07T23:59:59Z" } } }));
    const checkpoint = { v: 1, cursor: "next", pages: 1, records: 2, ids: ["1", "2"], cursors: [""], requestIds: [] };
    mocks.reviewPage.mockResolvedValue({ checkpoint, done: false, limited: false, terminationReason: null, created: 2, updated: 0, changed: 0, linksRechecked: 0 });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "checkpointed", nextTaskId: "task" });
    expect(mocks.reviewPage).toHaveBeenCalledWith(123, "shop-owner", undefined, undefined, "run");
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ checkpoint, dedupeKey: "reviews-page-1", metrics: expect.objectContaining({ reviewsObserved: 2, pagesObserved: 1, historyCompleteness: "unknown" }) }));
    expect(mocks.syncShopeeOrders).not.toHaveBeenCalled();
  });
  it("completes a provider-limited review window without claiming full history", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "reviews", run: { syncType: "reviews", requestedByUserId: "actor", input: { maxReviews: 1000 } } }));
    mocks.reviewPage.mockResolvedValue({ checkpoint: { pages: 10, records: 1000, ids: Array(1000).fill("id") }, done: true, limited: true, terminationReason: "documented_cap_boundary", created: 100, updated: 0, changed: 0, linksRechecked: 20 });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "completed" });
    expect(mocks.complete).toHaveBeenCalledWith("task", "worker", undefined, expect.objectContaining({ providerLimited: true, reviewsObserved: 1000, historyCompleteness: "unknown" }));
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
  it("fails permanent review errors safely and preserves optional-task handoff", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "reviews" }));
    mocks.reviewPage.mockRejectedValue(new ShopeeReviewError("REVIEW_PROVIDER_AUTH_REQUIRED", false, "error_auth", "request"));
    mocks.fail.mockResolvedValue({ settled: true, nextTaskId: "next" });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "failed", nextTaskId: "next" });
    expect(mocks.fail).toHaveBeenCalledWith("task", "worker", "REVIEW_PROVIDER_AUTH_REQUIRED", undefined, { code: "error_auth", requestId: "request", fields: [] });
  });
  it("does not advance reviews after losing the page lease", async () => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "reviews" }));
    mocks.reviewPage.mockResolvedValue({ checkpoint: { pages: 1, ids: [] }, done: true });
    mocks.renew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "skipped" });
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
  it.each(["retrying", "failed", "lost_lease"])("settles transient review failures as %s without advancing the page", async (status) => {
    mocks.claimed.mockResolvedValue(task({ runId: "run", stream: "reviews" }));
    mocks.reviewPage.mockRejectedValue(new ShopeeReviewError("REVIEW_PROVIDER_RATE_LIMIT", true, "rate_limit", "review-request"));
    mocks.retry.mockResolvedValue({ settled: status !== "lost_lease", status, nextTaskId: "task", nextAttemptAt: null });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: status === "lost_lease" ? "skipped" : status });
    expect(mocks.retry).toHaveBeenCalledWith("task", "worker", "REVIEW_PROVIDER_RATE_LIMIT", undefined, { code: "rate_limit", requestId: "review-request", fields: [] });
    expect(mocks.checkpoint).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("checkpoints historical ads in seven-day inclusive windows and counts campaign facts", async () => {
    const run = { syncType: "ads", requestedByUserId: "requester", input: { dateFrom: "2026-09-01T00:00:00+08:00", dateTo: "2026-09-30T23:59:59+08:00" } };
    mocks.claimed.mockResolvedValue(task({ stream: "ads", run }));
    mocks.syncShopeeAds.mockResolvedValue({ synced: 7, campaigns: 14, errors: [] });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "checkpointed" });
    expect(mocks.syncShopeeAds).toHaveBeenCalledWith(123, "shop-owner", { dateFrom: "2026-08-31T16:00:00.000Z", dateTo: "2026-09-07T15:59:59.000Z" }, "requester");
    const checkpoint = mocks.checkpoint.mock.calls[0]![0].checkpoint;
    expect(checkpoint).toMatchObject({ windowSeconds: 7 * 86400, windowsCompleted: 1, inclusive: true, from: Date.parse("2026-09-07T16:00:00Z") / 1000 });
    expect(mocks.checkpoint.mock.calls[0]![0].metrics).toMatchObject({ recordsSynced: 21 });
    mocks.claimed.mockResolvedValue(task({ stream: "ads", run, checkpoint }));
    await dispatchMarketplaceSyncTask("task", "worker");
    expect(mocks.syncShopeeAds.mock.calls[1]![2]).toEqual({ dateFrom: "2026-09-07T16:00:00.000Z", dateTo: "2026-09-14T15:59:59.000Z" });
  });

  it("keeps all-run ads on their independent 30-day refresh", async () => {
    mocks.claimed.mockResolvedValue(task({ stream: "ads", run: { syncType: "all", requestedByUserId: "requester", input: { dateFrom: "2026-09-01T00:00:00+08:00", dateTo: "2026-09-07T23:59:59+08:00" } } }));
    mocks.syncShopeeAds.mockResolvedValue({ synced: 30, campaigns: 120, errors: [] });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "completed" });
    expect(mocks.syncShopeeAds).toHaveBeenCalledWith(123, "shop-owner", 30, "requester");
    expect(mocks.complete).toHaveBeenCalledWith("task", "worker", undefined, expect.objectContaining({ recordsSynced: 150 }));
  });

  it.each(["SCHEMA_INVALID", "ACCESS_DENIED", "HTTP_REJECTED", "GRAPHQL_REJECTED", "THROTTLED", "TEMPORARY", "MALFORMED_RESPONSE"] as const)("settles Shopify %s with safe diagnostics and never checkpoints failed finance", async (code) => {
    const checkpoint = { from: 1785600000, end: 1785772799, windowsCompleted: 1, inclusive: true };
    mocks.claimed.mockResolvedValue(task({ platform: "shopify", stream: "finance", sequence: 2, checkpoint, run: { syncType: "all", requestedByUserId: "requester" } }));
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "shop-s", userId: "owner-s" });
    const error = new ShopifyProviderError(code, 200, "fixture-request");
    mocks.syncShopifyFinance.mockRejectedValue(error);
    mocks.fail.mockResolvedValue({ settled: true });
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "task", nextAttemptAt: null });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: error.retryable ? "retrying" : "failed" });
      expect(error.retryable ? mocks.retry : mocks.fail).toHaveBeenCalledWith("task", "worker", `SHOPIFY_${code}`, undefined, { code, requestId: "fixture-request", fields: [] });
      expect(error.retryable ? mocks.fail : mocks.retry).not.toHaveBeenCalled();
      expect(mocks.syncShopifyFinance).toHaveBeenCalledTimes(1);
      expect(mocks.checkpoint).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.syncShopifyOrders).not.toHaveBeenCalled();
      expect(mocks.syncShopifyProducts).not.toHaveBeenCalled();
      expect(mocks.invalidateMarketplaceAnalytics).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith("Marketplace provider task failure", expect.objectContaining({ providerCode: code, providerRequestId: "fixture-request", retryable: error.retryable }));
    } finally { warning.mockRestore(); }
  });

  it("retries Shopify finance per-record failures without advancing its checkpoint", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "shopify", stream: "finance" }));
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "shop-s", userId: "owner-s" });
    mocks.syncShopifyFinance.mockResolvedValue({ synced: 1, errors: ["private provider detail"] });
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "task", nextAttemptAt: null });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "retrying" });
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.retry.mock.calls)).not.toContain("private provider detail");
  });

  it.each([
    undefined,
    { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-31T23:59:59+08:00" },
  ])("refreshes Lazada products once without applying the order/finance date window", async (input) => {
    mocks.claimed.mockResolvedValue(task({ platform: "lazada", stream: "products", sequence: 1, run: { syncType: "all", requestedByUserId: "requester", input } }));
    mocks.lazadaShop.findUnique.mockResolvedValue({ sellerId: "seller", userId: "owner" });
    mocks.syncLazadaProducts.mockResolvedValue({ synced: 12, created: 2, updated: 10, errors: [] });

    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "completed" });

    expect(mocks.syncLazadaProducts).toHaveBeenCalledExactlyOnceWith("seller", "owner", "requester");
    expect(mocks.complete).toHaveBeenCalledWith("task", "worker", undefined, { recordsSynced: 12, recordsCreated: 2, recordsUpdated: 10 });
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.syncLazadaFinance).not.toHaveBeenCalled();
    expect(mocks.invalidateMarketplaceAnalytics).toHaveBeenCalledWith("lazada");
  });

  it.each(["tiktok", "shopify"] as const)("checkpoints %s orders and resumes the exact next second under the same lease engine", async (platform) => {
    const run = { syncType: "all", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-03T23:59:59+08:00" } };
    mocks.claimed.mockResolvedValue(task({ platform, stream: "orders", run }));
    mocks.tikTokShop.findUnique.mockResolvedValue({ shopId: "provider-t", userId: "owner-t" });
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "shop-s", userId: "owner-s" });
    mocks.syncTikTokOrders.mockResolvedValue({ synced: 2, created: 1, updated: 1, errors: [] });
    mocks.syncShopifyOrders.mockResolvedValue({ synced: 2, created: 1, updated: 1, errors: [] });

    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "checkpointed" });

    const sync = platform === "tiktok" ? mocks.syncTikTokOrders : mocks.syncShopifyOrders;
    const args = platform === "tiktok"
      ? ["provider-t", "owner-t", { from: 1785513600, to: 1785599999 }, "requester"]
      : ["shop-s", "owner-s", { from: "2026-07-31T16:00:00.000Z", to: "2026-08-01T15:59:59.000Z" }, "requester"];
    expect(sync).toHaveBeenCalledWith(...args);
    const checkpoint = mocks.checkpoint.mock.calls[0]![0].checkpoint;
    expect(checkpoint).toMatchObject({ from: 1785600000, windowsCompleted: 1, inclusive: true });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.renew).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateMarketplaceAnalytics).toHaveBeenCalledWith(platform);

    mocks.claimed.mockResolvedValue(task({ platform, stream: "orders", run, checkpoint }));
    await dispatchMarketplaceSyncTask("task", "worker");
    expect(sync.mock.calls[1]![2]).toEqual(platform === "tiktok"
      ? { from: 1785600000, to: 1785686399 }
      : { from: "2026-08-01T16:00:00.000Z", to: "2026-08-02T15:59:59.000Z" });
  });

  it.each(["tiktok", "shopify"] as const)("bounds %s finance without changing shop ownership or actor attribution", async (platform) => {
    mocks.claimed.mockResolvedValue(task({ platform, stream: "finance", run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-01T23:59:59+08:00" } } }));
    mocks.tikTokShop.findUnique.mockResolvedValue({ shopId: "provider-t", userId: "owner-t" });
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "shop-s", userId: "owner-s" });
    mocks.syncTikTokFinance.mockResolvedValue({ synced: 1, created: 1, updated: 0, errors: [] });
    mocks.syncShopifyFinance.mockResolvedValue({ synced: 1, created: 1, updated: 0, errors: [] });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "completed" });
    if (platform === "tiktok") expect(mocks.syncTikTokFinance).toHaveBeenCalledWith("provider-t", "owner-t", "requester", { from: 1785513600, to: 1785599999 });
    else expect(mocks.syncShopifyFinance).toHaveBeenCalledWith("shop-s", "owner-s", { from: "2026-07-31T16:00:00.000Z", to: "2026-08-01T15:59:59.000Z" }, "requester");
    expect(mocks.complete).toHaveBeenCalledWith("task", "worker", undefined, expect.objectContaining({ ordersSynced: 1 }));
  });

  it("does not checkpoint or advance new platform streams when the provider reports per-record errors", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "shopify", stream: "orders" }));
    mocks.shopifyShop.findUnique.mockResolvedValue({ id: "shop-s", userId: "owner-s" });
    mocks.syncShopifyOrders.mockResolvedValue({ synced: 1, errors: ["private provider detail"] });
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "task", nextAttemptAt: null });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toMatchObject({ status: "retrying" });
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.retry.mock.calls)).not.toContain("private provider detail");
  });

  it("fails deterministic TikTok auth errors with safe provider diagnostics", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "tiktok", stream: "orders" }));
    mocks.tikTokShop.findUnique.mockResolvedValue({ shopId: "provider-t", userId: "owner-t" });
    mocks.syncTikTokOrders.mockRejectedValue(new TikTokProviderError(12345, 401, "provider-id", "private-token"));
    mocks.fail.mockResolvedValue({ settled: true });
    await expect(dispatchMarketplaceSyncTask("task", "worker")).resolves.toEqual({ status: "failed" });
    expect(mocks.fail).toHaveBeenCalledWith("task", "worker", "TIKTOK_12345", undefined, { code: "12345", requestId: "provider-id", fields: [] });
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it("fails permanent Lazada response errors with a safe actionable code rather than repeatedly advancing or retrying", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "lazada", stream: "finance", run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00Z", dateTo: "2026-08-01T23:59:59Z" } } }));
    mocks.lazadaShop.findUnique.mockResolvedValue({ sellerId: "seller", userId: "owner" });
    mocks.syncLazadaFinance.mockRejectedValue(new LazadaProviderError("MALFORMED_FINANCE_NULL", 502, "fixture-request"));
    mocks.fail.mockResolvedValue({ settled: true });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toEqual({ status: "failed" });
      expect(mocks.fail).toHaveBeenCalledWith("a".repeat(24), "worker-a", "LAZADA_MALFORMED_FINANCE_NULL", undefined, { code: "MALFORMED_FINANCE_NULL", requestId: "fixture-request", fields: [] });
      expect(mocks.retry).not.toHaveBeenCalled();
      expect(mocks.checkpoint).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith("Marketplace provider task failure", expect.objectContaining({ providerCode: "MALFORMED_FINANCE_NULL", providerRequestId: "fixture-request" }));
    } finally { warning.mockRestore(); }
  });
  it("retains retry behavior for actual provider rate limiting", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "lazada", stream: "finance", run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00Z", dateTo: "2026-08-01T23:59:59Z" } } }));
    mocks.lazadaShop.findUnique.mockResolvedValue({ sellerId: "seller", userId: "owner" });
    mocks.syncLazadaFinance.mockRejectedValue(new LazadaProviderError("SellerCallLimit", 429));
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "task", nextAttemptAt: null });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toMatchObject({ status: "retrying" });
      expect(mocks.retry).toHaveBeenCalledWith("a".repeat(24), "worker-a", "LAZADA_SELLERCALLLIMIT", undefined, { code: "SellerCallLimit", requestId: null, fields: [] });
      expect(mocks.fail).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
  it("runs Lazada finance in frozen daily windows and checkpoints only completed work", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "lazada", stream: "finance", run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-03T23:59:59+08:00" } } }));
    mocks.lazadaShop.findUnique.mockResolvedValue({ sellerId: "seller", userId: "owner" });
    mocks.syncLazadaFinance.mockResolvedValue({ synced: 1, created: 1, updated: 0, errors: [] });
    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toMatchObject({ status: "checkpointed" });
    expect(mocks.syncLazadaFinance).toHaveBeenCalledWith("seller", "owner", { from: "2026-07-31T16:00:00.000Z", to: "2026-08-01T15:59:59.000Z" }, "requester");
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ checkpoint: expect.objectContaining({ inclusive: true, windowsCompleted: 1 }) }));
    expect(mocks.invalidateMarketplaceAnalytics).toHaveBeenCalledWith("lazada");
  });
  it("carries alias repair counts forward across finance window checkpoints", async () => {
    mocks.claimed.mockResolvedValue(task({ platform: "lazada", stream: "finance", metrics: { aliasesMerged: 2 }, run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-03T23:59:59+08:00" } } }));
    mocks.lazadaShop.findUnique.mockResolvedValue({ sellerId: "seller", userId: "owner" });
    mocks.syncLazadaFinance.mockResolvedValue({ synced: 1, created: 0, updated: 1, mergedAliases: 1, errors: [] });
    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toMatchObject({ status: "checkpointed" });
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ metrics: expect.objectContaining({ aliasesMerged: 3 }) }));
  });
  it("checkpoints a completed 24-hour orders window and republishes the same task", async () => {
    const now = new Date("2026-10-13T00:00:00.000Z");
    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "checkpointed", nextTaskId: "a".repeat(24) });

    expect(mocks.syncShopeeOrders).toHaveBeenCalledWith(123, "shop-owner", 1790553600, 1790640000, "requester");
    expect(mocks.syncShopeeProducts).not.toHaveBeenCalled();
    expect(mocks.syncShopeeAds).not.toHaveBeenCalled();
    expect(mocks.renew).toHaveBeenCalledTimes(2);
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      id: "a".repeat(24),
      workerId: "worker-a",
      checkpoint: { from: 1790640000, end: 1791849600, windowsCompleted: 1, windowSeconds: 86400, inclusive: false },
      metrics: { windowsCompleted: 1, ordersSynced: 1, ordersCreated: 0, ordersUpdated: 0, orderErrors: 0 },
      dedupeKey: "window-1",
    }));
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("completes the graph only after the final orders window", async () => {
    const now = new Date("2026-10-13T00:00:00.000Z");
    mocks.claimed.mockResolvedValue(task({ checkpoint: { from: 1791763200, end: 1791849600, windowsCompleted: 14 } }));

    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a", now)).resolves.toEqual({ status: "completed", nextTaskId: "c".repeat(24) });

    expect(mocks.syncShopeeOrders).toHaveBeenCalledWith(123, "shop-owner", 1791763200, 1791849600, "requester");
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith("a".repeat(24), "worker-a", undefined, {
      windowsCompleted: 15,
      ordersSynced: 1,
      ordersCreated: 0,
      ordersUpdated: 0,
      orderErrors: 0,
    });
  });

  it("retries only the failed task and never advances the graph", async () => {
    mocks.syncShopeeOrders.mockRejectedValue(new Error("token=provider-secret"));
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "a".repeat(24), nextAttemptAt: new Date("2026-10-06T12:01:00.000Z") });

    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toEqual({ status: "retrying", nextTaskId: "a".repeat(24), nextAttemptAt: new Date("2026-10-06T12:01:00.000Z") });
    expect(mocks.retry).toHaveBeenCalledWith("a".repeat(24), "worker-a", "SYNC_ATTEMPT_FAILED");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.retry.mock.calls)).not.toContain("provider-secret");
  });

  it("freezes an explicit historical boundary across checkpoint resumption", async () => {
    mocks.claimed.mockResolvedValue(task({
      run: { syncType: "finance", requestedByUserId: "requester", input: { dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-03T00:00:00Z" } },
      checkpoint: { from: 1735862400, end: 1735862400, windowsCompleted: 2 },
    }));

    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a", new Date("2026-10-13T00:00:00.000Z"))).resolves.toEqual({ status: "completed", nextTaskId: "c".repeat(24) });

    expect(mocks.syncShopeeOrders).toHaveBeenCalledWith(123, "shop-owner", 1735862400, 1735862400, "requester");
    expect(mocks.complete).toHaveBeenCalledWith("a".repeat(24), "worker-a", undefined, expect.objectContaining({ windowsCompleted: 3 }));
  });

  it("runs a date-scoped return task in one provider-safe window and retries provider-reported errors", async () => {
    mocks.claimed.mockResolvedValue(task({
      stream: "returns",
      run: { syncType: "returns", requestedByUserId: "requester", input: { dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" } },
    }));
    mocks.syncShopeeReturns.mockResolvedValue({ synced: 0, created: 0, updated: 0, errors: ["permission denied"] });
    mocks.retry.mockResolvedValue({ settled: true, status: "retrying", nextTaskId: "a".repeat(24), nextAttemptAt: null });

    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toEqual({ status: "retrying", nextTaskId: "a".repeat(24), nextAttemptAt: null });

    expect(mocks.syncShopeeReturns).toHaveBeenCalledWith(123, "shop-owner", 1735689600, 1735776000, "requester");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("passes one explicit bounded window to payout ingestion", async () => {
    mocks.claimed.mockResolvedValue(task({
      stream: "payouts",
      run: { syncType: "payouts", requestedByUserId: "requester", input: { dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" } },
    }));

    await expect(dispatchMarketplaceSyncTask("a".repeat(24), "worker-a")).resolves.toEqual({ status: "completed", nextTaskId: "c".repeat(24) });

    expect(mocks.syncShopeePayoutStatements).toHaveBeenCalledWith(123, "shop-owner", { timeFrom: 1735689600, timeTo: 1735776000 }, "requester");
  });
});
