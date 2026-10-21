import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  run: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  lease: { updateMany: vi.fn(), create: vi.fn() },
  outbox: { create: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(), enqueue: vi.fn(),
}));
const db = vi.hoisted(() => ({ marketplaceSyncTask: mocks.task, marketplaceSyncRun: mocks.run, marketplaceSyncShopLease: mocks.lease, marketplaceSyncDeliveryOutbox: mocks.outbox }));
vi.mock("@/prisma/client", () => ({ prisma: { ...db, $transaction: mocks.transaction } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: vi.fn() }));
vi.mock("./sync-enqueue", () => ({ enqueueMarketplaceSyncTask: mocks.enqueue }));

import { createMarketplaceSyncRun, claimMarketplaceSyncTask, completeMarketplaceSyncTask, checkpointMarketplaceSyncTask, retryMarketplaceSyncTask, deliverMarketplaceSyncTaskOutbox, marketplaceSyncRunResponse } from "./sync-runs";

const target = "http://localhost:3000";
const foreground = { mode: "foreground" as const, target };
const now = new Date("2026-10-21T12:00:00Z");
const task = (mode = "foreground") => ({ id: "task", runId: "run", platform: "lazada", shopId: "shop", sequence: 0, required: true, attempts: 1, run: { executionMode: mode, executionTarget: target }, nextAttemptAt: null, errors: [] });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((operation) => operation(db));
  mocks.run.findFirst.mockResolvedValue(null);
  mocks.run.create.mockImplementation(async ({ data }) => ({ id: "run", ...data, createdAt: now, updatedAt: now }));
  mocks.task.create.mockImplementation(async ({ data }) => ({ id: `task-${data.sequence}`, ...data }));
  mocks.task.findUnique.mockResolvedValue(task());
  mocks.task.findFirst.mockResolvedValue(task());
  mocks.task.findMany.mockResolvedValue([{ status: "completed", required: true }, { status: "pending", required: true }]);
  mocks.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.lease.updateMany.mockResolvedValue({ count: 1 });
});

describe("foreground execution isolation in the durable task engine", () => {
  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("persists %s foreground ownership without creating a queue outbox", async (platform) => {
    const result = await createMarketplaceSyncRun({ platform, shopId: "shop", requestedByUserId: "actor", syncType: "all", execution: foreground });
    expect(mocks.run.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionMode: "foreground", executionTarget: target }) }));
    expect(result.run.tasks.map(({ stream }) => stream)).toContain("products");
    expect(mocks.outbox.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(marketplaceSyncRunResponse(result.run)).toMatchObject({ executionMode: "foreground", executionTarget: target });
  });

  it.each([
    { run: task(), execution: undefined },
    { run: task(), execution: { mode: "foreground" as const, target: "https://console.example.test" } },
    { run: task("queued"), execution: foreground },
  ])("rejects the wrong execution mode/origin before mutating attempts or leases", async ({ run, execution }) => {
    mocks.task.findUnique.mockResolvedValue(run);
    await expect(claimMarketplaceSyncTask("task", "worker", now, execution)).resolves.toBe(false);
    expect(mocks.task.updateMany).not.toHaveBeenCalled();
    expect(mocks.lease.updateMany).not.toHaveBeenCalled();
  });

  it.each(["foreground", "queued"] as const)("uses the same atomic task and shop leases for %s execution", async (mode) => {
    mocks.task.findUnique.mockResolvedValue(task(mode));
    mocks.task.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(claimMarketplaceSyncTask("task", "worker", now, mode === "foreground" ? foreground : undefined)).resolves.toBe(true);
    expect(mocks.lease.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ platform: "lazada", shopId: "shop" }) }));
    expect(mocks.task.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "running", leaseOwner: "worker", attempts: { increment: 1 } }) }));
  });

  it("keeps old runs with no execution fields claimable by queued workers", async () => {
    mocks.task.findUnique.mockResolvedValue({ ...task(), run: {} });
    mocks.task.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(claimMarketplaceSyncTask("task", "worker", now)).resolves.toBe(true);
  });

  it("does not claim a foreground task while another task owns the shop lease", async () => {
    mocks.task.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.lease.updateMany.mockResolvedValue({ count: 0 });
    mocks.lease.create.mockRejectedValue({ code: "P2002" });
    await expect(claimMarketplaceSyncTask("task", "worker", now, foreground)).resolves.toBe(false);
    expect(mocks.task.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.run.updateMany).not.toHaveBeenCalled();
  });

  it.each(["foreground", "queued"] as const)("persists %s checkpoints but publishes delivery only for queued work", async (mode) => {
    mocks.task.findFirst.mockResolvedValue(task(mode));
    await expect(checkpointMarketplaceSyncTask({ id: "task", workerId: "worker", checkpoint: { from: 123 }, metrics: { ordersSynced: 3 }, dedupeKey: "window-1", now })).resolves.toEqual({ settled: true });
    expect(mocks.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending", checkpoint: { from: 123 }, metrics: { ordersSynced: 3 }, attempts: 0, leaseOwner: null }) }));
    expect(mocks.outbox.upsert).toHaveBeenCalledTimes(mode === "queued" ? 1 : 0);
    expect(mocks.lease.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { holderTaskId: null, leaseExpiresAt: null } }));
  });

  it.each(["foreground", "queued"] as const)("advances the %s graph without crossing execution modes", async (mode) => {
    mocks.task.findFirst.mockResolvedValueOnce(task(mode)).mockResolvedValueOnce({ id: "products-task" });
    await expect(completeMarketplaceSyncTask("task", "worker", now, { recordsSynced: 1 })).resolves.toMatchObject({ settled: true, nextTaskId: "products-task" });
    expect(mocks.outbox.upsert).toHaveBeenCalledTimes(mode === "queued" ? 1 : 0);
  });

  it.each(["foreground", "queued"] as const)("saves retry state for %s execution and queues only queued retries", async (mode) => {
    mocks.task.findFirst.mockResolvedValue(task(mode));
    mocks.task.findUnique.mockResolvedValue({ nextAttemptAt: new Date(now.getTime() + 30_000) });
    await expect(retryMarketplaceSyncTask("task", "worker", "SYNC_ATTEMPT_FAILED", now)).resolves.toMatchObject({ settled: true, status: "retrying" });
    expect(mocks.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "retrying", leaseOwner: null, nextAttemptAt: expect.any(Date) }) }));
    expect(mocks.outbox.upsert).toHaveBeenCalledTimes(mode === "queued" ? 1 : 0);
  });

  it("will not publish a foreground task even if an outbox row exists", async () => {
    await expect(deliverMarketplaceSyncTaskOutbox("task", now)).resolves.toEqual({ scheduled: false, taskId: "task" });
    expect(mocks.outbox.findFirst).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["queued", "http://other-api:3000"])("does not coalesce an idempotency key from %s execution ownership", async (owner) => {
    mocks.run.findFirst.mockResolvedValue({ executionMode: owner === "queued" ? "queued" : "foreground", executionTarget: owner, tasks: [{ id: "task" }] });
    await expect(createMarketplaceSyncRun({ platform: "lazada", shopId: "shop", requestedByUserId: "actor", syncType: "all", execution: foreground, idempotencyKey: "request" })).rejects.toThrow("different execution mode or API origin");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reuses an idempotent foreground request from the same API without recreating or queuing tasks", async () => {
    mocks.run.findFirst.mockResolvedValue({ id: "run", executionMode: "foreground", executionTarget: target, tasks: [{ id: "first" }] });
    await expect(createMarketplaceSyncRun({ platform: "lazada", shopId: "shop", requestedByUserId: "actor", syncType: "all", execution: foreground, idempotencyKey: "request" })).resolves.toMatchObject({ coalesced: true, firstTaskId: "first" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
