export type MarketplaceSyncExecution =
  | { mode: "queued" }
  | { mode: "foreground"; target: string };

type ExecutionRecord = { executionMode?: string | null; executionTarget?: string | null };

/** Older runs without a mode are queued. Foreground runs are never queue work. */
export function matchesMarketplaceSyncExecution(run: ExecutionRecord, execution: MarketplaceSyncExecution = { mode: "queued" }) {
  const mode = run.executionMode ?? "queued";
  return mode === execution.mode && (execution.mode !== "foreground" || run.executionTarget === execution.target);
}

export class MarketplaceSyncExecutionConflictError extends Error {}
