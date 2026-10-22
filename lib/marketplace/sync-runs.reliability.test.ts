import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() });
  return { task: model(), run: model(), lease: model(), outbox: model(), transaction: vi.fn(), enqueue: vi.fn() };
});
const db = vi.hoisted(() => ({ marketplaceSyncTask: m.task, marketplaceSyncRun: m.run, marketplaceSyncShopLease: m.lease, marketplaceSyncDeliveryOutbox: m.outbox }));
vi.mock("@/prisma/client", () => ({ prisma: { ...db, $transaction: m.transaction } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: async () => ["owner"] }));
vi.mock("./sync-enqueue", () => ({ enqueueMarketplaceSyncTask: m.enqueue }));
import { checkpointMarketplaceSyncTask, claimMarketplaceSyncTask, completeMarketplaceSyncTask, deliverMarketplaceSyncTaskOutbox, failMarketplaceSyncTask, getMarketplaceSyncTaskRecoveryDelivery, marketplaceSyncRunStatus, renewMarketplaceSyncTaskLease, retryMarketplaceSyncTask } from "./sync-runs";
import { MAX_MARKETPLACE_SYNC_ATTEMPTS } from "./sync-jobs";

const now = new Date("2026-10-21T12:00:00Z");
const task = () => ({ id: "task", platform: "shopee", shopId: "shop", runId: "run", sequence: 0, required: true, attempts: 1, errors: [], run: { executionMode: "queued" } });
const checkpoint = { id: "task", workerId: "worker", checkpoint: { from: 200 }, metrics: { ordersSynced: 1 }, dedupeKey: "window-1", now };

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((work) => work(db));
  m.task.findUnique.mockResolvedValue(task());
  m.task.findFirst.mockResolvedValue(task());
  m.task.findMany.mockResolvedValue([{ status: "completed", required: true }]);
  m.task.updateMany.mockResolvedValue({ count: 1 });
  m.lease.updateMany.mockResolvedValue({ count: 1 });
  m.outbox.findFirst.mockResolvedValue({ id: "delivery" });
  m.outbox.updateMany.mockResolvedValue({ count: 1 });
  m.enqueue.mockResolvedValue({ scheduled: true });
});

describe("task lease fencing and attempt exhaustion", () => {
  it("renews both the task and its shop lease only for a live owned task", async () => {
    expect(await renewMarketplaceSyncTaskLease("task", "worker", now)).toBe(true);
    expect(m.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task", status: "running", leaseOwner: "worker", leaseExpiresAt: { gt: now } } }));
    expect(m.lease.updateMany).toHaveBeenCalledWith({ where: { platform: "shopee", shopId: "shop", holderTaskId: "task" }, data: { leaseExpiresAt: new Date(now.getTime() + 240000) } });
  });

  it.each(["lookup", "compare-and-set"])("does not renew the shop after losing ownership at %s", async (stage) => {
    if (stage === "lookup") m.task.findFirst.mockResolvedValue(null);
    else m.task.updateMany.mockResolvedValue({ count: 0 });
    expect(await renewMarketplaceSyncTaskLease("task", "worker", now)).toBe(false);
    expect(m.lease.updateMany).not.toHaveBeenCalled();
  });

  it("does not steal a busy shop lease when a competing insert wins", async () => {
    m.task.updateMany.mockResolvedValueOnce({ count: 0 });
    m.lease.updateMany.mockResolvedValue({ count: 0 });
    m.lease.create.mockRejectedValue({ code: "P2002" });
    expect(await claimMarketplaceSyncTask("task", "worker", now)).toBe(false);
    expect(m.task.updateMany).toHaveBeenCalledTimes(1);
    expect(m.run.updateMany).not.toHaveBeenCalled();
  });

  it("propagates a real database failure instead of treating it as lease contention", async () => {
    m.task.updateMany.mockResolvedValueOnce({ count: 0 });
    m.lease.updateMany.mockResolvedValue({ count: 0 });
    const error = new Error("database unavailable");
    m.lease.create.mockRejectedValue(error);
    await expect(claimMarketplaceSyncTask("task", "worker", now)).rejects.toBe(error);
  });

  it("releases an acquired shop lease if neither the strict nor legacy pending claim succeeds", async () => {
    m.task.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimMarketplaceSyncTask("task", "worker", now)).toBe(false);
    expect(m.task.updateMany).toHaveBeenCalledTimes(3);
    expect(m.lease.updateMany).toHaveBeenLastCalledWith({ where: { platform: "shopee", shopId: "shop", holderTaskId: "task" }, data: { holderTaskId: null, leaseExpiresAt: null } });
  });

  it("settles expired final attempts and blocks dependent work without executing a provider", async () => {
    m.task.updateMany.mockResolvedValueOnce({ count: 1 });
    m.task.findMany.mockResolvedValue([{ status: "failed", required: true, lastError: "ATTEMPTS_EXHAUSTED" }, { status: "cancelled", required: true }]);
    expect(await claimMarketplaceSyncTask("task", "worker", now)).toBe(false);
    expect(m.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled", lastError: "BLOCKED_BY_REQUIRED_TASK" }) }));
    expect(m.run.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed", lastError: "ATTEMPTS_EXHAUSTED", completedAt: now } }));
  });
});

describe("task settlement cannot outlive a worker lease", () => {
  it.each(["complete", "checkpoint", "retry", "fail"])("rejects %s without a currently claimed task", async (operation) => {
    m.task.findFirst.mockResolvedValue(null);
    const result = operation === "complete" ? await completeMarketplaceSyncTask("task", "worker", now)
      : operation === "checkpoint" ? await checkpointMarketplaceSyncTask(checkpoint)
        : operation === "retry" ? await retryMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now)
          : await failMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now);
    expect(result).toEqual({ settled: false });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.outbox.upsert).not.toHaveBeenCalled();
  });

  it.each(["complete", "checkpoint", "retry", "fail"])("does not publish or release another worker's lease after a lost %s compare-and-set", async (operation) => {
    m.task.updateMany.mockResolvedValue({ count: 0 });
    const result = operation === "complete" ? await completeMarketplaceSyncTask("task", "worker", now)
      : operation === "checkpoint" ? await checkpointMarketplaceSyncTask(checkpoint)
        : operation === "retry" ? await retryMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now)
          : await failMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now);
    expect(result).toEqual({ settled: false });
    expect(m.outbox.upsert).not.toHaveBeenCalled();
    expect(m.lease.updateMany).not.toHaveBeenCalled();
  });

  it("finalizes a completed parent only after its last task is terminal", async () => {
    m.task.findFirst.mockResolvedValueOnce(task()).mockResolvedValueOnce(null);
    expect(await completeMarketplaceSyncTask("task", "worker", now, { recordsSynced: 3 })).toMatchObject({ settled: true, runStatus: "completed" });
    expect(m.run.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "completed", lastError: null, completedAt: now } }));
    expect(m.outbox.upsert).not.toHaveBeenCalled();
  });

  it.each([true, false])("exhausts retries without publishing another retry (required=%s)", async (required) => {
    m.task.findFirst.mockResolvedValue({ ...task(), required, attempts: MAX_MARKETPLACE_SYNC_ATTEMPTS });
    m.task.findMany.mockResolvedValue([{ required, status: "failed" }]);
    const result = await retryMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now);
    expect(result).toMatchObject({ settled: true, status: "failed", runStatus: required ? "failed" : "completed_with_warnings" });
    expect(m.outbox.upsert).not.toHaveBeenCalled();
    expect(m.task.updateMany.mock.calls.some(([args]) => args.data.lastError === "BLOCKED_BY_REQUIRED_TASK")).toBe(required);
  });

  it("keeps only bounded safe provider diagnostics when retrying", async () => {
    m.task.findFirst.mockResolvedValue({ ...task(), errors: Array.from({ length: 10 }, (_, index) => ({ code: String(index) })) });
    m.task.findUnique.mockResolvedValue({ nextAttemptAt: new Date(now.getTime() + 30000) });
    await retryMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now, { code: "private token", requestId: "request\nprivate", fields: ["amount", "private field"] });
    const errors = m.task.updateMany.mock.calls[0]![0].data.errors;
    expect(errors).toHaveLength(5);
    expect(errors[4]).toMatchObject({ provider: { code: null, requestId: null, fields: ["amount"] } });
    expect(JSON.stringify(errors)).not.toContain("private");
    expect(m.outbox.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { taskId: "task", dedupeKey: "retry-1" } }));
  });

  it("cancels dependent tasks after a permanent required failure", async () => {
    m.task.findMany.mockResolvedValue([{ required: true, status: "failed" }, { required: true, status: "cancelled" }]);
    expect(await failMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now)).toMatchObject({ status: "failed", runStatus: "failed" });
    expect(m.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ runId: "run", sequence: { gt: 0 } }), data: expect.objectContaining({ status: "cancelled" }) }));
  });

  it("keeps completed Shopify orders/products persisted when required finance fails the parent", async () => {
    const predecessors = [
      { id: "orders", sequence: 0, stream: "orders", required: true, status: "completed", metrics: { ordersSynced: 8 }, checkpoint: { from: 100 } },
      { id: "products", sequence: 1, stream: "products", required: true, status: "completed", metrics: { recordsSynced: 107 } },
    ];
    const before = structuredClone(predecessors);
    const finance = { ...task(), id: "finance", platform: "shopify", sequence: 2, stream: "finance", status: "running", checkpoint: { from: 200 }, metrics: { ordersSynced: 0 } };
    const rows = [...predecessors, finance];
    m.task.findFirst.mockResolvedValue(finance);
    m.task.findMany.mockImplementation(async () => rows);
    m.task.updateMany.mockImplementation(async ({ where, data }) => {
      const matching = rows.filter((row) => where.id ? row.id === where.id && row.status === where.status
        : row.sequence > where.sequence.gt && where.status.in.includes(row.status));
      matching.forEach((row) => Object.assign(row, data));
      return { count: matching.length };
    });
    expect(await failMarketplaceSyncTask("finance", "worker", "SHOPIFY_SCHEMA_INVALID", now, { code: "SCHEMA_INVALID", requestId: "fixture-request", fields: [] })).toMatchObject({ settled: true, status: "failed", runStatus: "failed" });
    expect(predecessors).toEqual(before);
    expect(finance).toMatchObject({ status: "failed", checkpoint: { from: 200 }, metrics: { ordersSynced: 0 }, attempts: 1 });
    expect(m.run.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed", lastError: "SHOPIFY_SCHEMA_INVALID", completedAt: now } }));
    expect(m.outbox.upsert).not.toHaveBeenCalled();
  });
});

describe("durable outbox publication and hand-off recovery", () => {
  it.each([false, true])("persists delivery outcome without losing durable work (scheduled=%s)", async (scheduled) => {
    m.task.findUnique.mockResolvedValue({ ...task(), nextAttemptAt: now });
    m.enqueue.mockResolvedValue({ scheduled });
    expect(await deliverMarketplaceSyncTaskOutbox("task", now)).toEqual({ scheduled, taskId: "task" });
    expect(m.enqueue).toHaveBeenCalledWith("task", { notBefore: now });
    expect(m.outbox.updateMany).toHaveBeenLastCalledWith({ where: { id: "delivery", status: "publishing", leaseOwner: expect.any(String) }, data: expect.objectContaining({ status: scheduled ? "delivered" : "retrying", leaseOwner: null, leaseExpiresAt: null, lastError: scheduled ? null : "DELIVERY_FAILED" }) });
  });

  it.each(["missing-task", "no-outbox", "lost-claim"])("does not enqueue work at %s", async (stage) => {
    if (stage === "missing-task") m.task.findUnique.mockResolvedValue(null);
    if (stage === "no-outbox") m.outbox.findFirst.mockResolvedValue(null);
    if (stage === "lost-claim") m.outbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await deliverMarketplaceSyncTaskOutbox("task", now)).toEqual({ scheduled: false, taskId: "task" });
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it.each(["pending", "running", "failed", "cancelled"])("does not recover a delivery for a %s task", async (status) => {
    m.task.findUnique.mockResolvedValue({ ...task(), status });
    expect(await getMarketplaceSyncTaskRecoveryDelivery("task", now)).toBeNull();
    expect(m.outbox.findFirst).not.toHaveBeenCalled();
  });

  it("recovers a retry delivery or the completed task's successor only while an outbox entry is pending", async () => {
    m.task.findUnique.mockResolvedValue({ ...task(), status: "retrying" });
    expect(await getMarketplaceSyncTaskRecoveryDelivery("task", now)).toBe("task");
    m.task.findUnique.mockResolvedValue({ ...task(), status: "completed" });
    m.task.findFirst.mockResolvedValue({ id: "next" });
    expect(await getMarketplaceSyncTaskRecoveryDelivery("task", now)).toBe("next");
    m.outbox.findFirst.mockResolvedValue(null);
    expect(await getMarketplaceSyncTaskRecoveryDelivery("task", now)).toBeNull();
  });

  it("does not report an empty or unfinished task graph as complete", () => {
    expect(marketplaceSyncRunStatus([])).toBeNull();
    expect(marketplaceSyncRunStatus([{ required: true, status: "retrying" }])).toBeNull();
    expect(marketplaceSyncRunStatus([{ required: true, status: "cancelled" }])).toBe("failed");
  });
});
