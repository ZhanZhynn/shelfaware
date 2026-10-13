# Bounded Marketplace Sync Plan

## Objective

Replace timeout-prone whole-shop sync invocations with durable, observable,
bounded work units. A task must checkpoint and return before the five-minute
serverless execution limit.

## Principles

- A run is a user-visible synchronization request; a task is one bounded worker
  unit within that run.
- QStash wakes workers but does not define correctness. Database leases,
  idempotent writes, checkpoints, and an outbox provide recovery.
- Tasks are serial within a shop until provider clients and locking are proven
  safe for same-shop concurrency. Different shops may execute independently.
- Completed and failed runs are historical records and never block a later run.
- Order and finance work is prioritized. Optional streams may complete a run
  with warnings instead of hiding successful required work.

## Delivery

1. Add `MarketplaceSyncRun`, `MarketplaceSyncTask`, and a delivery outbox.
2. Make `all` create a parent run plus serial Shopee tasks instead of one long
   provider invocation.
3. Give each task a short renewable lease, stable retries, checkpoint data, and
   progress metrics.
4. Add a worker endpoint that claims one task, executes it, records an outcome,
   and schedules the next task.
5. Keep the current sync routes compatible by returning a run-shaped response;
   add task progress to status output.
6. Migrate other platform streams and legacy synchronous routes after Shopee
   task orchestration is proven in production.

## Initial Shopee Graph

```text
orders-and-escrow -> products -> ads
```

Each stream is a separately delivered task. Subsequent work will split each
stream further by provider cursor and date window. The initial graph removes the
most harmful behavior: products, orders, and ads no longer compete inside a
single five-minute invocation.

## Operational Limits

- Worker request budget: 240 seconds.
- Task lease: 4 minutes, renewed around bounded provider work.
- Provider calls require explicit timeouts and must stop before the worker
  budget is exhausted.
- Retried tasks use persisted `nextAttemptAt`; duplicate queue messages only
  contend for the database lease.

## Completion Criteria

- An `all` request reports per-task progress and terminal partial success.
- A completed or failed run does not coalesce a later request.
- A worker timeout can retry only the unfinished task rather than the whole
  shop workflow.
- Finance freshness records the most recent completed orders-and-escrow task.
