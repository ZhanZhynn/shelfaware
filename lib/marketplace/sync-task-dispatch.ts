import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { syncShopeeAds, syncShopeeOrders, syncShopeeProducts } from "@/lib/shopee";
import { prisma } from "@/prisma/client";
import {
  claimMarketplaceSyncTask,
  completeMarketplaceSyncTask,
  failMarketplaceSyncTask,
  getClaimedMarketplaceSyncTask,
  renewMarketplaceSyncTaskLease,
  retryMarketplaceSyncTask,
} from "./sync-runs";

export type MarketplaceSyncTaskDispatchResult =
  | { status: "skipped" }
  | { status: "completed"; nextTaskId?: string }
  | { status: "retrying"; nextTaskId: string; nextAttemptAt: Date | null }
  | { status: "failed" };

class PermanentTaskDispatchError extends Error {
  constructor(readonly code: "SHOP_NOT_FOUND" | "TASK_STREAM_UNSUPPORTED") {
    super(code);
  }
}

async function runShopeeTask(task: NonNullable<Awaited<ReturnType<typeof getClaimedMarketplaceSyncTask>>>) {
  const shop = await prisma.shopeeShop.findUnique({ where: { id: task.shopId }, select: { shopId: true, userId: true } });
  if (!shop) throw new PermanentTaskDispatchError("SHOP_NOT_FOUND");
  // Preserve the prior `all` semantics: orders have no date window and ads
  // use the established 30-day default. Each provider call is now isolated.
  switch (task.stream) {
    case "orders_and_escrow": return syncShopeeOrders(shop.shopId, shop.userId, undefined, undefined, task.run.requestedByUserId);
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
    await runShopeeTask(task);
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    await Promise.all([invalidateCache(cacheKeys.shopee.pattern), invalidateMarketplaceAnalytics("shopee")]);
    const settled = await completeMarketplaceSyncTask(id, workerId);
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
