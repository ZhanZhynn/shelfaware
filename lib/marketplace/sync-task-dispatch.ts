import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { syncShopeeAds, syncShopeeOrders, syncShopeeProducts } from "@/lib/shopee";
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
const ORDER_LOOKBACK_SECONDS = 15 * ORDER_WINDOW_SECONDS;

type OrdersWindow = { from: number; to: number; end: number; windowsCompleted: number };

function ordersWindow(checkpoint: unknown, now: Date): OrdersWindow {
  const value = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)
    ? checkpoint as Record<string, unknown>
    : null;
  const end = typeof value?.end === "number" && Number.isInteger(value.end)
    ? value.end
    : Math.floor(now.getTime() / 1000);
  const from = typeof value?.from === "number" && Number.isInteger(value.from)
    ? value.from
    : end - ORDER_LOOKBACK_SECONDS;
  const windowsCompleted = typeof value?.windowsCompleted === "number" && Number.isInteger(value.windowsCompleted)
    ? value.windowsCompleted
    : 0;
  return { from, to: Math.min(from + ORDER_WINDOW_SECONDS, end), end, windowsCompleted };
}

function numberMetric(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" ? metric : 0;
}

function ordersWindowMetrics(previous: unknown, window: OrdersWindow, result: { synced: number; created: number; updated: number; errors: string[] }) {
  return {
    windowsCompleted: window.windowsCompleted + 1,
    ordersSynced: numberMetric(previous, "ordersSynced") + result.synced,
    ordersCreated: numberMetric(previous, "ordersCreated") + result.created,
    ordersUpdated: numberMetric(previous, "ordersUpdated") + result.updated,
    orderErrors: numberMetric(previous, "orderErrors") + result.errors.length,
  };
}

async function runShopeeTask(task: NonNullable<Awaited<ReturnType<typeof getClaimedMarketplaceSyncTask>>>, window?: OrdersWindow) {
  const shop = await prisma.shopeeShop.findUnique({ where: { id: task.shopId }, select: { shopId: true, userId: true } });
  if (!shop) throw new PermanentTaskDispatchError("SHOP_NOT_FOUND");
  // Preserve the prior `all` semantics: orders have no date window and ads
  // use the established 30-day default. Each provider call is now isolated.
  switch (task.stream) {
    case "orders_and_escrow": return syncShopeeOrders(shop.shopId, shop.userId, window?.from, window?.to, task.run.requestedByUserId);
    case "products": return syncShopeeProducts(shop.shopId, shop.userId, task.run.requestedByUserId);
    case "ads": return syncShopeeAds(shop.shopId, shop.userId, 30, task.run.requestedByUserId);
    default: throw new PermanentTaskDispatchError("TASK_STREAM_UNSUPPORTED");
  }
}

/** Claim, execute, and settle one bounded Shopee `all` stream task. */
export async function dispatchMarketplaceSyncTask(id: string, workerId: string, now = new Date()): Promise<MarketplaceSyncTaskDispatchResult> {
  if (!(await claimMarketplaceSyncTask(id, workerId, now))) return { status: "skipped" };
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  if (!task || task.platform !== "shopee" || task.run.syncType !== "all") {
    await failMarketplaceSyncTask(id, workerId, "TASK_STREAM_UNSUPPORTED", now);
    return { status: "failed" };
  }

  try {
    // Renew immediately before and after the bounded provider call. A task
    // cannot settle after it loses its durable four-minute lease.
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    const window = task.stream === "orders_and_escrow" ? ordersWindow(task.checkpoint, now) : undefined;
    const result = await runShopeeTask(task, window);
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    await Promise.all([invalidateCache(cacheKeys.shopee.pattern), invalidateMarketplaceAnalytics("shopee")]);
    if (window && window.to < window.end) {
      const metrics = ordersWindowMetrics(task.metrics, window, result as { synced: number; created: number; updated: number; errors: string[] });
      const checkpointed = await checkpointMarketplaceSyncTask({
        id,
        workerId,
        checkpoint: { from: window.to, end: window.end, windowsCompleted: metrics.windowsCompleted, windowSeconds: ORDER_WINDOW_SECONDS },
        metrics,
        dedupeKey: `window-${metrics.windowsCompleted}`,
      });
      return checkpointed.settled ? { status: "checkpointed", nextTaskId: id } : { status: "skipped" };
    }
    const metrics = window
      ? ordersWindowMetrics(task.metrics, window, result as { synced: number; created: number; updated: number; errors: string[] })
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
