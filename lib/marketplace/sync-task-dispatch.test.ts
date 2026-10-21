import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpoint: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), claimed: vi.fn(), renew: vi.fn(), retry: vi.fn(),
  invalidateCache: vi.fn(), invalidateMarketplaceAnalytics: vi.fn(),
  shopeeShop: { findUnique: vi.fn() },
  lazadaShop: { findUnique: vi.fn() },
  syncLazadaOrders: vi.fn(), syncLazadaFinance: vi.fn(), syncLazadaPayoutStatements: vi.fn(),
  syncShopeeOrders: vi.fn(), syncShopeeProducts: vi.fn(), syncShopeeAds: vi.fn(), syncShopeeReturns: vi.fn(), syncShopeePayoutStatements: vi.fn(),
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
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: mocks.shopeeShop, lazadaShop: mocks.lazadaShop } }));
vi.mock("@/lib/cache/cache-utils", () => ({
  cacheKeys: { shopee: { pattern: "shopee:*" }, lazada: { pattern: "lazada:*" } },
  invalidateCache: mocks.invalidateCache,
  invalidateMarketplaceAnalytics: mocks.invalidateMarketplaceAnalytics,
}));
vi.mock("@/lib/shopee", () => ({ syncShopeeOrders: mocks.syncShopeeOrders, syncShopeeProducts: mocks.syncShopeeProducts, syncShopeeAds: mocks.syncShopeeAds, syncShopeeReturns: mocks.syncShopeeReturns, syncShopeePayoutStatements: mocks.syncShopeePayoutStatements }));
vi.mock("@/lib/lazada", () => ({ syncLazadaOrders: mocks.syncLazadaOrders, syncLazadaFinance: mocks.syncLazadaFinance, syncLazadaPayoutStatements: mocks.syncLazadaPayoutStatements }));

import { dispatchMarketplaceSyncTask } from "./sync-task-dispatch";
import { LazadaProviderError } from "@/lib/lazada/provider-error";

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
