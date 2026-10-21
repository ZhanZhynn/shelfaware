import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import type { MarketplacePlatform } from "./analytics/types";
import {
  claimMarketplaceSyncJob, completeMarketplaceSyncJob, failMarketplaceSyncJob,
  getClaimedMarketplaceSyncJob, getMarketplaceSyncJobNextAttempt, retryMarketplaceSyncJob,
} from "./sync-jobs";
import { PermanentDispatchError, runMarketplaceSync } from "./sync-provider";

const WORKER_LEASE_MS = 15 * 60 * 1000;
const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export type MarketplaceSyncDispatchResult =
  | { status: "skipped" }
  | { status: "completed" }
  | { status: "retrying"; nextAttemptAt: Date | null }
  | { status: "failed" };

function hasResultErrors(result: unknown) {
  return !!result && typeof result === "object" && Array.isArray((result as { errors?: unknown }).errors) && (result as { errors: unknown[] }).errors.length > 0;
}

function providerReturnedErrors(result: unknown, syncType: string) {
  if (hasResultErrors(result)) return true;
  if (syncType !== "all" || !result || typeof result !== "object") return false;
  const streams = result as Record<string, unknown>;
  return ["products", "orders", "ads", "finance"].some((stream) => hasResultErrors(streams[stream]));
}

/** Retain delivery support for jobs created before checkpointed task graphs. */
export async function dispatchMarketplaceSyncJob(id: string, workerId: string, now = new Date()): Promise<MarketplaceSyncDispatchResult> {
  if (!(await claimMarketplaceSyncJob(id, workerId, now, WORKER_LEASE_MS))) return { status: "skipped" };
  const job = await getClaimedMarketplaceSyncJob(id, workerId, now);
  if (!job || !platforms.has(job.platform as MarketplacePlatform)) {
    await failMarketplaceSyncJob(id, workerId, "SYNC_TYPE_UNSUPPORTED", now);
    return { status: "failed" };
  }
  try {
    const result = await runMarketplaceSync(job.platform as MarketplacePlatform, job.shopId, job.requestedByUserId, job.syncType, job.input);
    if (providerReturnedErrors(result, job.syncType)) throw new Error("PROVIDER_RETURNED_ERRORS");
    const platform = job.platform as MarketplacePlatform;
    await Promise.all([invalidateCache(cacheKeys[platform].pattern), invalidateMarketplaceAnalytics(platform)]);
    return (await completeMarketplaceSyncJob(id, workerId)) ? { status: "completed" } : { status: "skipped" };
  } catch (error) {
    if (error instanceof PermanentDispatchError) {
      await failMarketplaceSyncJob(id, workerId, error.code);
      return { status: "failed" };
    }
    if (!(await retryMarketplaceSyncJob(id, workerId, "SYNC_ATTEMPT_FAILED"))) return { status: "skipped" };
    const retry = await getMarketplaceSyncJobNextAttempt(id);
    return { status: "retrying", nextAttemptAt: retry?.nextAttemptAt ?? null };
  }
}
