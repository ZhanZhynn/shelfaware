import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { LazadaProviderError, lazadaSyncFailure } from "@/lib/lazada/provider-error";
import { TikTokProviderError } from "@/lib/tiktok/provider-error";
import type { MarketplacePlatform } from "./analytics/types";
import { marketplaceSyncTaskGraph } from "./sync-plan";
import { PermanentDispatchError, runMarketplaceSync } from "./sync-provider";
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
  const windowSeconds = ["orders_and_escrow", "orders", "finance"].includes(task.stream) ? ORDER_WINDOW_SECONDS
    : task.stream === "returns" || (task.stream === "payouts" && task.platform !== "tiktok") ? FINANCIAL_WINDOW_SECONDS
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
  const aliasesMerged = numberMetric(previous, "aliasesMerged") + numberMetric(result, "mergedAliases");
  return {
    windowsCompleted: window.windowsCompleted + 1,
    ordersSynced: numberMetric(previous, "ordersSynced") + result.synced,
    ordersCreated: numberMetric(previous, "ordersCreated") + (result.created ?? 0),
    ordersUpdated: numberMetric(previous, "ordersUpdated") + (result.updated ?? 0),
    orderErrors: numberMetric(previous, "orderErrors") + result.errors.length,
    ...(aliasesMerged ? { aliasesMerged } : {}),
  };
}

/** Claim, execute, and settle one provider-safe, checkpointed stream window. */
export async function dispatchMarketplaceSyncTask(id: string, workerId: string, now = new Date()): Promise<MarketplaceSyncTaskDispatchResult> {
  if (!(await claimMarketplaceSyncTask(id, workerId, now))) return { status: "skipped" };
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  const platform = task?.platform as MarketplacePlatform;
  if (!task || !marketplaceSyncTaskGraph(platform, task.run.syncType).some(({ stream }) => stream === task.stream)) {
    await failMarketplaceSyncTask(id, workerId, "TASK_STREAM_UNSUPPORTED", now);
    return { status: "failed" };
  }

  try {
    // Renew immediately before and after the bounded provider call. A task
    // cannot settle after it loses its durable four-minute lease.
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    const window = taskWindow(task, now);
    const input = window ? { dateFrom: new Date(window.from * 1000).toISOString(), dateTo: new Date(window.to * 1000).toISOString() }
      : task.stream === "ads" ? { daysBack: 30 } : task.run.input;
    const result = await runMarketplaceSync(platform, task.shopId, task.run.requestedByUserId, task.stream, input);
    if (!(await renewMarketplaceSyncTaskLease(id, workerId))) return { status: "skipped" };
    if (!("synced" in result) || !("errors" in result)) throw new PermanentTaskDispatchError("TASK_STREAM_UNSUPPORTED");
    if (result.errors.length) throw new Error("PROVIDER_RETURNED_ERRORS");
    await Promise.all([invalidateCache(cacheKeys[platform].pattern), invalidateMarketplaceAnalytics(platform)]);
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
      : { recordsSynced: result.synced, recordsCreated: "created" in result ? result.created : 0, recordsUpdated: "updated" in result ? result.updated : 0 };
    const settled = await completeMarketplaceSyncTask(id, workerId, undefined, metrics);
    return settled.settled ? { status: "completed", nextTaskId: settled.nextTaskId } : { status: "skipped" };
  } catch (error) {
    if (error instanceof LazadaProviderError || error instanceof TikTokProviderError) {
      const failure = error instanceof LazadaProviderError ? lazadaSyncFailure(error) : {
        code: `TIKTOK_${error.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`.slice(0, 64),
        retryable: ["temporary", "rate_limit"].includes(error.kind),
      };
      const provider = { code: error.code, requestId: error.providerRequestId, fields: error instanceof LazadaProviderError ? error.fields : [] };
      console.warn("Marketplace provider task failure", { taskId: id, platform: task.platform, providerCode: error.code, providerRequestId: error.providerRequestId, httpStatus: error.status, retryable: failure.retryable });
      if (!failure.retryable) {
        const settled = await failMarketplaceSyncTask(id, workerId, failure.code, undefined, provider);
        return settled.settled ? { status: "failed" } : { status: "skipped" };
      }
      const settled = await retryMarketplaceSyncTask(id, workerId, failure.code, undefined, provider);
      if (!settled.settled) return { status: "skipped" };
      return settled.status === "retrying" ? { status: "retrying", nextTaskId: settled.nextTaskId, nextAttemptAt: settled.nextAttemptAt } : { status: "failed" };
    }
    if (error instanceof PermanentTaskDispatchError || error instanceof PermanentDispatchError) {
      const settled = await failMarketplaceSyncTask(id, workerId, error.code === "SYNC_TYPE_UNSUPPORTED" ? "TASK_STREAM_UNSUPPORTED" : error.code);
      return settled.settled ? { status: "failed" } : { status: "skipped" };
    }
    const settled = await retryMarketplaceSyncTask(id, workerId, "SYNC_ATTEMPT_FAILED");
    if (!settled.settled) return { status: "skipped" };
    return settled.status === "retrying"
      ? { status: "retrying", nextTaskId: settled.nextTaskId, nextAttemptAt: settled.nextAttemptAt }
      : { status: "failed" };
  }
}
