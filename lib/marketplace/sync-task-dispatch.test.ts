import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpoint: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), claimed: vi.fn(), renew: vi.fn(), retry: vi.fn(),
  invalidateCache: vi.fn(), invalidateMarketplaceAnalytics: vi.fn(),
  shopeeShop: { findUnique: vi.fn() },
  syncShopeeOrders: vi.fn(), syncShopeeProducts: vi.fn(), syncShopeeAds: vi.fn(),
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
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: mocks.shopeeShop } }));
vi.mock("@/lib/cache/cache-utils", () => ({
  cacheKeys: { shopee: { pattern: "shopee:*" } },
  invalidateCache: mocks.invalidateCache,
  invalidateMarketplaceAnalytics: mocks.invalidateMarketplaceAnalytics,
}));
vi.mock("@/lib/shopee", () => ({ syncShopeeOrders: mocks.syncShopeeOrders, syncShopeeProducts: mocks.syncShopeeProducts, syncShopeeAds: mocks.syncShopeeAds }));

import { dispatchMarketplaceSyncTask } from "./sync-task-dispatch";

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
  mocks.invalidateCache.mockResolvedValue(undefined);
  mocks.invalidateMarketplaceAnalytics.mockResolvedValue(undefined);
});

describe("dispatchMarketplaceSyncTask", () => {
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
      checkpoint: { from: 1790640000, end: 1791849600, windowsCompleted: 1, windowSeconds: 86400 },
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
});
