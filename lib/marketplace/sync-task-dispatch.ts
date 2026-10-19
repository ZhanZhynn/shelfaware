import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { syncShopeeAds, syncShopeeOrders, syncShopeePayoutStatements, syncShopeeProducts, syncShopeeReturns } from "@/lib/shopee";
import { prisma } from "@/prisma/client";
import {
  checkpointMarketplaceSyncTask,
  claimMarketplaceSyncTask,
  completeMarketplaceSyncTask,
  failMarketplaceSyncTask,
  getClaimedMarketplaceSyncTask,
  renewMarketplaceSyncTaskLease,
  retryMarketplaceSyncTask,
} from "./sync-runs";
import { marketplaceSyncDateRange } from "./sync-jobs";

export type MarketplaceSyncTaskDispatchResult =
  | { status: "skipped" }
  | { status: "checkpointed"; nextTaskId: string }
  | { status: "completed"; nextTaskId?: string }
  | { status: "retrying"; nextTaskId: string; nextAttemptAt: Date | null }
  | { status: "failed" };

class PermanentTaskDispatchError extends Error {
  constructor(readonly code: "SHOP_NOT_FOUND" | "TASK_STREAM_UNSUPPORTED") {
    super(code);
  }
}

const ORDER_WINDOW_SECONDS = 24 * 60 * 60;
const FINANCIAL_WINDOW_SECONDS = 15 * 24 * 60 * 60;
const ORDER_LOOKBACK_SECONDS = 15 * ORDER_WINDOW_SECONDS;

type SyncWindow = { from: number; to: number; end: number; windowsCompleted: number; windowSeconds: number; inclusive: boolean };

function taskWindow(task: NonNullable<Awaited<ReturnType<typeof getClaimedMarketplaceSyncTask>>>, now: Date): SyncWindow | undefined {
  const windowSeconds = task.stream === "orders_and_escrow" ? ORDER_WINDOW_SECONDS
    : task.stream === "returns" || task.stream === "payouts" ? FINANCIAL_WINDOW_SECONDS
      : undefined;
  if (!windowSeconds) return undefined;
  const value = task.checkpoint && typeof task.checkpoint === "object" && !Array.isArray(task.checkpoint)
    ? task.checkpoint as Record<string, unknown>
    : null;
  const range = marketplaceSyncDateRange(task.run.input);
  // Old all-run checkpoints overlap their boundary. Keep that cursor contract;
  // explicit date ranges are inclusive and advance past each completed second.
  const inclusive = range !== null || value?.inclusive === true;
  const end = typeof value?.end === "number" && Number.isInteger(value.end)
    ? value.end
    : range?.timeTo ?? Math.floor(now.getTime() / 1000);
  const from = typeof value?.from === "number" && Number.isInteger(value.from)
    ? value.from
    : range?.timeFrom ?? end - ORDER_LOOKBACK_SECONDS;
  const windowsCompleted = typeof value?.windowsCompleted === "number" && Number.isInteger(value.windowsCompleted)
    ? value.windowsCompleted
    : 0;
  return { from, to: Math.min(from + windowSeconds - (inclusive ? 1 : 0), end), end, windowsCompleted, windowSeconds, inclusive };
}

function numberMetric(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" ? metric : 0;
}

function windowMetrics(previous: unknown, window: SyncWindow, result: { synced: number; created?: number; updated?: number; errors: string[] }) {
  return {
    windowsCompleted: window.windowsCompleted + 1,
    ordersSynced: numberMetric(previous, "ordersSynced") + result.synced,
    ordersCreated: numberMetric(previous, "ordersCreated") + (result.created ?? 0),
    ordersUpdated: numberMetric(previous, "ordersUpdated") + (result.updated ?? 0),
    orderErrors: numberMetric(previous, "orderErrors") + result.errors.length,
  };
}

async function runShopeeTask(task: NonNullable<Awaited<ReturnType<typeof getClaimedMarketplaceSyncTask>>>, window?: SyncWindow) {
  const shop = await prisma.shopeeShop.findUnique({ where: { id: task.shopId }, select: { shopId: true, userId: true } });
  if (!shop) throw new PermanentTaskDispatchError("SHOP_NOT_FOUND");
  // Preserve the prior `all` products/ads defaults while isolating provider calls.
  switch (task.stream) {
    case "orders_and_escrow": return syncShopeeOrders(shop.shopId, shop.userId, window?.from, window?.to, task.run.requestedByUserId);
    case "returns": return syncShopeeReturns(shop.shopId, shop.userId, window?.from, window?.to, task.run.requestedByUserId);
    case "payouts": return syncShopeePayoutStatements(shop.shopId, shop.userId, window ? { timeFrom: window.from, timeTo: window.to } : undefined, task.run.requestedByUserId);
    case "products": return syncShopeeProducts(shop.shopId, shop.userId, task.run.requestedByUserId);
    case "ads": return syncShopeeAds(shop.shopId, shop.userId, 30, task.run.requestedByUserId);
    default: throw new PermanentTaskDispatchError("TASK_STREAM_UNSUPPORTED");
  }
}

/** Claim, execute, and settle one bounded Shopee stream task. */
export async function dispatchMarketplaceSyncTask(id: string, workerId: string, now = new Date()): Promise<MarketplaceSyncTaskDispatchResult> {
  if (!(await claimMarketplaceSyncTask(id, workerId, now))) return { status: "skipped" };
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  if (!task || task.platform !== "shopee" || !["all", "orders", "finance", "returns", "payouts"].includes(task.run.syncType)) {
    await failMarketplaceSyncTask(id, workerId, "TASK_STREAM_UNSUPPORTED", now);
    return { status: "failed" };
  }

  try {
    // Renew immediately before and after the bounded provider call. A task
    // cannot settle after it loses its durable four-minute lease.
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    const window = taskWindow(task, now);
    const result = await runShopeeTask(task, window);
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    if (result.errors.length) throw new Error("PROVIDER_RETURNED_ERRORS");
    await Promise.all([invalidateCache(cacheKeys.shopee.pattern), invalidateMarketplaceAnalytics("shopee")]);
    if (window && window.to < window.end) {
      const metrics = windowMetrics(task.metrics, window, result);
      const checkpointed = await checkpointMarketplaceSyncTask({
        id,
        workerId,
        checkpoint: { from: window.to + (window.inclusive ? 1 : 0), end: window.end, windowsCompleted: metrics.windowsCompleted, windowSeconds: window.windowSeconds, inclusive: window.inclusive },
        metrics,
        dedupeKey: `window-${metrics.windowsCompleted}`,
      });
      return checkpointed.settled ? { status: "checkpointed", nextTaskId: id } : { status: "skipped" };
    }
    const metrics = window
      ? windowMetrics(task.metrics, window, result)
      : undefined;
    const settled = await completeMarketplaceSyncTask(id, workerId, undefined, metrics);
    return settled.settled ? { status: "completed", nextTaskId: settled.nextTaskId } : { status: "skipped" };
  } catch (error) {
    if (error instanceof PermanentTaskDispatchError) {
      const settled = await failMarketplaceSyncTask(id, workerId, error.code);
      return settled.settled ? { status: "failed" } : { status: "skipped" };
    }
    const settled = await retryMarketplaceSyncTask(id, workerId, "SYNC_ATTEMPT_FAILED");
    if (!settled.settled) return { status: "skipped" };
    return settled.status === "retrying"
      ? { status: "retrying", nextTaskId: settled.nextTaskId, nextAttemptAt: settled.nextAttemptAt }
      : { status: "failed" };
  }
}
