import { getMarketplaceSyncRun } from "./sync-runs";
import { dispatchMarketplaceSyncTask } from "./sync-task-dispatch";
import { matchesMarketplaceSyncExecution, MarketplaceSyncExecutionConflictError } from "./sync-execution";
import type { MarketplacePlatform } from "./analytics/types";

const terminalRuns = new Set(["completed", "completed_with_warnings", "failed", "cancelled"]);
const terminalTasks = new Set(["completed", "failed", "cancelled"]);

type Run = Awaited<ReturnType<typeof getMarketplaceSyncRun>>;

function retryDelay(run: Run, now = Date.now()) {
  const task = run.tasks.find(({ status }) => !terminalTasks.has(status));
  const due = task?.nextAttemptAt?.getTime() ?? task?.leaseExpiresAt?.getTime() ?? now;
  return Math.max(0, Math.ceil((due - now) / 1000));
}

/** Execute at most one owned task/window on this API. No queue delivery occurs. */
export async function executeMarketplaceSyncForeground(
  platform: MarketplacePlatform,
  id: string,
  actor: Parameters<typeof getMarketplaceSyncRun>[2],
  target: string,
) {
  const execution = { mode: "foreground" as const, target };
  const run = await getMarketplaceSyncRun(platform, id, actor);
  if (!matchesMarketplaceSyncExecution(run, execution)) {
    throw new MarketplaceSyncExecutionConflictError("Foreground execution requires a foreground run created on this API origin");
  }
  if (terminalRuns.has(run.status)) return { run, outcome: "terminal", retryAfterSeconds: 0 };
  const task = run.tasks.find(({ status }) => !terminalTasks.has(status));
  if (!task) throw new Error("SYNC_STATE_INVALID");
  const delay = retryDelay(run);
  if (delay > 0) return { run, outcome: "waiting", retryAfterSeconds: delay };

  const result = await dispatchMarketplaceSyncTask(task.id, crypto.randomUUID(), new Date(), execution);
  const updated = await getMarketplaceSyncRun(platform, id, actor);
  return { run: updated, outcome: result.status, retryAfterSeconds: terminalRuns.has(updated.status) ? 0 : retryDelay(updated) };
}
