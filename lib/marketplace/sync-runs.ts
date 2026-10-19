import { Prisma } from "@prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { prisma } from "@/prisma/client";
import type { MarketplacePlatform } from "./analytics/types";
import { enqueueMarketplaceSyncTask } from "./sync-enqueue";
import { marketplaceSyncErrorCode, marketplaceSyncRetryAt, MAX_MARKETPLACE_SYNC_ATTEMPTS, type MarketplaceSyncInput } from "./sync-jobs";

const taskStatuses = ["pending", "running", "retrying", "completed", "failed", "cancelled"] as const;
const terminalTaskStatuses = new Set(["completed", "failed", "cancelled"]);
const TASK_LEASE_MS = 4 * 60 * 1000;
const OUTBOX_LEASE_MS = 60 * 1000;

export const shopeeAllTaskGraph = [
  { stream: "orders_and_escrow", required: true },
  { stream: "products", required: true },
  { stream: "ads", required: false },
] as const;

const shopeeBoundedTaskStreams = {
  orders: "orders_and_escrow",
  finance: "orders_and_escrow",
  returns: "returns",
  payouts: "payouts",
} as const;

export class MarketplaceSyncRunNotFoundError extends Error {}

type MarketplaceActor = Parameters<typeof marketplaceOwnerIds>[0];

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** A parent is terminal only once every stream is terminal. */
export function marketplaceSyncRunStatus(tasks: Array<{ status: string; required: boolean }>) {
  if (!tasks.length || !tasks.every((task) => terminalTaskStatuses.has(task.status))) return null;
  const requiredFailed = tasks.some((task) => task.required && task.status !== "completed");
  const optionalFailed = tasks.some((task) => !task.required && task.status !== "completed");
  return requiredFailed ? "failed" : optionalFailed ? "completed_with_warnings" : "completed";
}

/** Create the full graph atomically before attempting any external delivery. */
export async function createShopeeAllSyncRun(input: {
  shopId: string;
  requestedByUserId: string;
  idempotencyKey?: string;
  input?: MarketplaceSyncInput;
}) {
  if (input.idempotencyKey) {
    const existing = await prisma.marketplaceSyncRun.findFirst({
      where: { platform: "shopee", shopId: input.shopId, requestedByUserId: input.requestedByUserId, idempotencyKey: input.idempotencyKey },
      include: { tasks: { orderBy: { sequence: "asc" } } },
    });
    if (existing) return { run: existing, coalesced: true, firstTaskId: existing.tasks[0]?.id };
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.marketplaceSyncRun.create({
      data: {
        platform: "shopee",
        shopId: input.shopId,
        syncType: "all",
        requestedByUserId: input.requestedByUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        input: input.input ?? null,
      },
    });
    const tasks = await Promise.all(shopeeAllTaskGraph.map((task, sequence) => tx.marketplaceSyncTask.create({
      data: { runId: created.id, platform: "shopee", shopId: input.shopId, stream: task.stream, sequence, required: task.required },
    })));
    await tx.marketplaceSyncDeliveryOutbox.create({ data: { taskId: tasks[0]!.id, dedupeKey: "initial" } });
    return { ...created, tasks };
  });
  return { run, coalesced: false, firstTaskId: run.tasks[0]?.id };
}

/** Date-scoped Shopee streams are always executed as checkpointed tasks. */
export async function createShopeeBoundedSyncRun(input: {
  shopId: string;
  requestedByUserId: string;
  syncType: keyof typeof shopeeBoundedTaskStreams;
  idempotencyKey?: string;
  input: MarketplaceSyncInput;
}) {
  if (input.idempotencyKey) {
    const existing = await prisma.marketplaceSyncRun.findFirst({
      where: { platform: "shopee", shopId: input.shopId, requestedByUserId: input.requestedByUserId, idempotencyKey: input.idempotencyKey },
      include: { tasks: { orderBy: { sequence: "asc" } } },
    });
    if (existing) return { run: existing, coalesced: true, firstTaskId: existing.tasks[0]?.id };
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.marketplaceSyncRun.create({
      data: {
        platform: "shopee",
        shopId: input.shopId,
        syncType: input.syncType,
        requestedByUserId: input.requestedByUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        input: input.input,
      },
    });
    const task = await tx.marketplaceSyncTask.create({
      data: { runId: created.id, platform: "shopee", shopId: input.shopId, stream: shopeeBoundedTaskStreams[input.syncType], sequence: 0, required: true },
    });
    await tx.marketplaceSyncDeliveryOutbox.create({ data: { taskId: task.id, dedupeKey: "initial" } });
    return { ...created, tasks: [task] };
  });
  return { run, coalesced: false, firstTaskId: run.tasks[0]?.id };
}

/** A task delivery is at-least-once; this function only publishes durable work. */
export async function deliverMarketplaceSyncTaskOutbox(taskId: string, now = new Date()) {
  const outbox = await prisma.marketplaceSyncDeliveryOutbox.findFirst({
    where: {
      taskId,
      OR: [
        { status: { in: ["pending", "retrying"] } },
        { status: "publishing", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!outbox) return { scheduled: false, taskId };

  const workerId = crypto.randomUUID();
  const claimed = await prisma.marketplaceSyncDeliveryOutbox.updateMany({
    where: {
      id: outbox.id,
      OR: [
        { status: { in: ["pending", "retrying"] } },
        { status: "publishing", leaseExpiresAt: { lte: now } },
      ],
    },
    data: { status: "publishing", attempts: { increment: 1 }, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + OUTBOX_LEASE_MS) },
  });
  if (claimed.count !== 1) return { scheduled: false, taskId };

  const task = await prisma.marketplaceSyncTask.findUnique({ where: { id: taskId }, select: { nextAttemptAt: true } });
  const queued = await enqueueMarketplaceSyncTask(taskId, { notBefore: task?.nextAttemptAt ?? undefined });
  await prisma.marketplaceSyncDeliveryOutbox.updateMany({
    where: { id: outbox.id, status: "publishing", leaseOwner: workerId },
    data: queued.scheduled
      ? { status: "delivered", publishedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: null }
      : { status: "retrying", leaseOwner: null, leaseExpiresAt: null, lastError: "DELIVERY_FAILED" },
  });
  return { scheduled: queued.scheduled, taskId };
}

/** Recover the hand-off after a worker settled a task but timed out before it
 * acknowledged its queue delivery. It republishes only a still-undelivered
 * outbox row, so ordinary duplicate queue messages are harmless. */
export async function getMarketplaceSyncTaskRecoveryDelivery(taskId: string, now = new Date()) {
  const task = await prisma.marketplaceSyncTask.findUnique({ where: { id: taskId }, select: { id: true, runId: true, sequence: true, status: true } });
  if (!task) return null;
  let candidateId: string | undefined;
  if (task.status === "retrying") candidateId = task.id;
  if (task.status === "completed") {
    candidateId = (await prisma.marketplaceSyncTask.findFirst({ where: { runId: task.runId, sequence: task.sequence + 1 }, select: { id: true } }))?.id;
  }
  if (!candidateId) return null;
  const pending = await prisma.marketplaceSyncDeliveryOutbox.findFirst({
    where: { taskId: candidateId, OR: [{ status: { in: ["pending", "retrying"] } }, { status: "publishing", leaseExpiresAt: { lte: now } }] },
    select: { id: true },
  });
  return pending ? candidateId : null;
}

async function acquireShopLease(task: { id: string; platform: string; shopId: string }, now: Date) {
  const expiry = new Date(now.getTime() + TASK_LEASE_MS);
  const updated = await prisma.marketplaceSyncShopLease.updateMany({
    where: { platform: task.platform, shopId: task.shopId, OR: [{ holderTaskId: null }, { leaseExpiresAt: { lte: now } }] },
    data: { holderTaskId: task.id, leaseExpiresAt: expiry },
  });
  if (updated.count === 1) return true;
  try {
    await prisma.marketplaceSyncShopLease.create({ data: { platform: task.platform, shopId: task.shopId, holderTaskId: task.id, leaseExpiresAt: expiry } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function releaseShopLease(task: { id: string; platform: string; shopId: string }) {
  await prisma.marketplaceSyncShopLease.updateMany({
    where: { platform: task.platform, shopId: task.shopId, holderTaskId: task.id },
    data: { holderTaskId: null, leaseExpiresAt: null },
  });
}

export async function claimMarketplaceSyncTask(id: string, workerId: string, now = new Date()) {
  const exhausted = await prisma.marketplaceSyncTask.updateMany({
    where: { id, status: "running", attempts: { gte: MAX_MARKETPLACE_SYNC_ATTEMPTS }, leaseExpiresAt: { lte: now } },
    data: { status: "failed", completedAt: now, lastError: "ATTEMPTS_EXHAUSTED", leaseOwner: null, leaseExpiresAt: null },
  });
  if (exhausted.count) await settleExpiredMarketplaceSyncTask(id, now);
  const task = await prisma.marketplaceSyncTask.findUnique({ where: { id }, select: { id: true, runId: true, platform: true, shopId: true } });
  if (!task || !(await acquireShopLease(task, now))) return false;
  const result = await prisma.marketplaceSyncTask.updateMany({
    where: {
      id,
      status: { in: ["pending", "retrying", "running"] },
      attempts: { lt: MAX_MARKETPLACE_SYNC_ATTEMPTS },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    data: { status: "running", attempts: { increment: 1 }, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + TASK_LEASE_MS), startedAt: now, nextAttemptAt: null },
  });
  if (result.count === 1) {
    await prisma.marketplaceSyncRun.updateMany({ where: { id: task.runId, status: "pending" }, data: { status: "running", startedAt: now } });
    return true;
  }
  // MongoDB may omit nullable fields on a new document, which makes the
  // strict due/lease predicate above miss an otherwise claimable pending task.
  // Pending tasks have no active worker by invariant, so this cannot steal a
  // live lease from retrying or running work.
  const pending = await prisma.marketplaceSyncTask.updateMany({
    where: { id, status: "pending", attempts: { lt: MAX_MARKETPLACE_SYNC_ATTEMPTS } },
    data: { status: "running", attempts: { increment: 1 }, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + TASK_LEASE_MS), startedAt: now, nextAttemptAt: null },
  });
  if (pending.count === 1) {
    await prisma.marketplaceSyncRun.updateMany({ where: { id: task.runId, status: "pending" }, data: { status: "running", startedAt: now } });
    return true;
  }
  await releaseShopLease(task);
  return false;
}

export async function renewMarketplaceSyncTaskLease(id: string, workerId: string, now = new Date()) {
  const task = await prisma.marketplaceSyncTask.findFirst({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } }, select: { id: true, platform: true, shopId: true } });
  if (!task) return false;
  const expiry = new Date(now.getTime() + TASK_LEASE_MS);
  const renewed = await prisma.marketplaceSyncTask.updateMany({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: expiry } });
  if (renewed.count === 1) await prisma.marketplaceSyncShopLease.updateMany({ where: { platform: task.platform, shopId: task.shopId, holderTaskId: id }, data: { leaseExpiresAt: expiry } });
  return renewed.count === 1;
}

export async function getClaimedMarketplaceSyncTask(id: string, workerId: string, now = new Date()) {
  return prisma.marketplaceSyncTask.findFirst({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } }, include: { run: true } });
}

async function finalizeMarketplaceSyncRun(runId: string, now: Date) {
  const tasks = await prisma.marketplaceSyncTask.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
  const status = marketplaceSyncRunStatus(tasks);
  if (!status) return null;
  const lastError = tasks.find((task) => task.status === "failed")?.lastError ?? null;
  await prisma.marketplaceSyncRun.updateMany({ where: { id: runId, status: { in: ["pending", "running"] } }, data: { status, lastError, completedAt: now } });
  return status;
}

/** A worker can discover an expired final attempt; settle its graph without
 * pretending the new worker owned the old lease. */
async function settleExpiredMarketplaceSyncTask(id: string, now: Date) {
  const task = await prisma.marketplaceSyncTask.findUnique({ where: { id }, select: { id: true, runId: true, sequence: true, required: true, platform: true, shopId: true } });
  if (!task) return;
  await releaseShopLease(task);
  if (task.required) await prisma.marketplaceSyncTask.updateMany({
    where: { runId: task.runId, sequence: { gt: task.sequence }, status: { in: ["pending", "retrying"] } },
    data: { status: "cancelled", completedAt: now, lastError: "BLOCKED_BY_REQUIRED_TASK" },
  });
  await finalizeMarketplaceSyncRun(task.runId, now);
}

export async function completeMarketplaceSyncTask(id: string, workerId: string, now = new Date(), metrics?: Prisma.InputJsonValue) {
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  if (!task) return { settled: false as const };
  const settled = await prisma.$transaction(async (tx) => {
    const completed = await tx.marketplaceSyncTask.updateMany({
      where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
      data: { status: "completed", completedAt: now, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, lastError: null, ...(metrics === undefined ? {} : { metrics }) },
    });
    if (completed.count !== 1) return { settled: false as const };
    const next = await tx.marketplaceSyncTask.findFirst({ where: { runId: task.runId, sequence: task.sequence + 1 }, select: { id: true } });
    if (next) await tx.marketplaceSyncDeliveryOutbox.upsert({ where: { taskId_dedupeKey: { taskId: next.id, dedupeKey: "initial" } }, create: { taskId: next.id, dedupeKey: "initial" }, update: {} });
    const tasks = await tx.marketplaceSyncTask.findMany({ where: { runId: task.runId }, orderBy: { sequence: "asc" } });
    let runStatus: string | null = null;
    if (tasks.length && tasks.every((item) => terminalTaskStatuses.has(item.status))) {
      runStatus = marketplaceSyncRunStatus(tasks);
      const lastError = tasks.find((item) => item.status === "failed")?.lastError ?? null;
      await tx.marketplaceSyncRun.updateMany({ where: { id: task.runId, status: { in: ["pending", "running"] } }, data: { status: runStatus!, lastError, completedAt: now } });
    }
    return { settled: true as const, nextTaskId: next?.id, runStatus };
  });
  if (!settled.settled) return settled;
  await releaseShopLease(task);
  return settled;
}

/** Persist completed work within a long stream and schedule the same task's
 * next bounded window. Attempts reset because the limit applies per window,
 * while progress remains visible through the checkpoint metrics. */
export async function checkpointMarketplaceSyncTask(input: {
  id: string;
  workerId: string;
  checkpoint: Prisma.InputJsonValue;
  metrics: Prisma.InputJsonValue;
  dedupeKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const task = await getClaimedMarketplaceSyncTask(input.id, input.workerId, now);
  if (!task) return { settled: false as const };
  const settled = await prisma.$transaction(async (tx) => {
    const checkpointed = await tx.marketplaceSyncTask.updateMany({
      where: { id: input.id, status: "running", leaseOwner: input.workerId, leaseExpiresAt: { gt: now } },
      data: {
        status: "pending",
        attempts: 0,
        checkpoint: input.checkpoint,
        metrics: input.metrics,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    if (checkpointed.count !== 1) return { settled: false as const };
    await tx.marketplaceSyncDeliveryOutbox.upsert({
      where: { taskId_dedupeKey: { taskId: input.id, dedupeKey: input.dedupeKey } },
      create: { taskId: input.id, dedupeKey: input.dedupeKey },
      update: {},
    });
    return { settled: true as const };
  });
  if (!settled.settled) return settled;
  await releaseShopLease(task);
  return settled;
}

export async function retryMarketplaceSyncTask(id: string, workerId: string, error: string, now = new Date()) {
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  if (!task) return { settled: false as const };
  const code = marketplaceSyncErrorCode(error);
  const exhausted = task.attempts >= MAX_MARKETPLACE_SYNC_ATTEMPTS;
  const errors = Array.isArray(task.errors) ? task.errors.slice(-4) : [];
  errors.push({ at: now.toISOString(), code });
  const settled = await prisma.$transaction(async (tx) => {
    const result = await tx.marketplaceSyncTask.updateMany({
      where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
      data: { status: exhausted ? "failed" : "retrying", completedAt: exhausted ? now : null, nextAttemptAt: exhausted ? null : marketplaceSyncRetryAt(task.attempts, now), lastError: code, errors: errors as Prisma.InputJsonArray, leaseOwner: null, leaseExpiresAt: null },
    });
    if (result.count !== 1) return { settled: false as const };
    if (!exhausted) {
      await tx.marketplaceSyncDeliveryOutbox.upsert({ where: { taskId_dedupeKey: { taskId: id, dedupeKey: `retry-${task.attempts}` } }, create: { taskId: id, dedupeKey: `retry-${task.attempts}` }, update: {} });
      const nextAttempt = await tx.marketplaceSyncTask.findUnique({ where: { id }, select: { nextAttemptAt: true } });
      return { settled: true as const, status: "retrying" as const, nextTaskId: id, nextAttemptAt: nextAttempt?.nextAttemptAt ?? null };
    }
    if (task.required) await tx.marketplaceSyncTask.updateMany({ where: { runId: task.runId, sequence: { gt: task.sequence }, status: { in: ["pending", "retrying"] } }, data: { status: "cancelled", completedAt: now, lastError: "BLOCKED_BY_REQUIRED_TASK" } });
    const tasks = await tx.marketplaceSyncTask.findMany({ where: { runId: task.runId }, orderBy: { sequence: "asc" } });
    const runStatus = marketplaceSyncRunStatus(tasks);
    if (runStatus) await tx.marketplaceSyncRun.updateMany({ where: { id: task.runId, status: { in: ["pending", "running"] } }, data: { status: runStatus, lastError: code, completedAt: now } });
    return { settled: true as const, status: "failed" as const, runStatus };
  });
  if (!settled.settled) return settled;
  await releaseShopLease(task);
  return settled;
}

export async function failMarketplaceSyncTask(id: string, workerId: string, error: string, now = new Date()) {
  const task = await getClaimedMarketplaceSyncTask(id, workerId, now);
  if (!task) return { settled: false as const };
  const code = marketplaceSyncErrorCode(error);
  const settled = await prisma.$transaction(async (tx) => {
    const result = await tx.marketplaceSyncTask.updateMany({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } }, data: { status: "failed", completedAt: now, nextAttemptAt: null, lastError: code, errors: [{ at: now.toISOString(), code }] as Prisma.InputJsonArray, leaseOwner: null, leaseExpiresAt: null } });
    if (result.count !== 1) return { settled: false as const };
    if (task.required) await tx.marketplaceSyncTask.updateMany({ where: { runId: task.runId, sequence: { gt: task.sequence }, status: { in: ["pending", "retrying"] } }, data: { status: "cancelled", completedAt: now, lastError: "BLOCKED_BY_REQUIRED_TASK" } });
    const tasks = await tx.marketplaceSyncTask.findMany({ where: { runId: task.runId }, orderBy: { sequence: "asc" } });
    const runStatus = marketplaceSyncRunStatus(tasks);
    if (runStatus) await tx.marketplaceSyncRun.updateMany({ where: { id: task.runId, status: { in: ["pending", "running"] } }, data: { status: runStatus, lastError: code, completedAt: now } });
    return { settled: true as const, status: "failed" as const, runStatus };
  });
  if (!settled.settled) return settled;
  await releaseShopLease(task);
  return settled;
}

const ownedShopeeRun = async (id: string, ownerIds: string[]) => prisma.marketplaceSyncRun.findFirst({
  where: { id, platform: "shopee", requestedByUserId: { in: ownerIds } },
  include: { tasks: { orderBy: { sequence: "asc" } } },
});

export async function getMarketplaceSyncRun(platform: MarketplacePlatform, id: string, actor: MarketplaceActor) {
  if (platform !== "shopee") throw new MarketplaceSyncRunNotFoundError("Sync run not found");
  const ownerIds = await marketplaceOwnerIds(actor);
  const run = await ownedShopeeRun(id, ownerIds);
  if (!run) throw new MarketplaceSyncRunNotFoundError("Sync run not found");
  const shop = await prisma.shopeeShop.findFirst({ where: { id: run.shopId, userId: { in: ownerIds } }, select: { id: true } });
  if (!shop) throw new MarketplaceSyncRunNotFoundError("Sync run not found");
  return run;
}

export function marketplaceSyncRunResponse(run: Awaited<ReturnType<typeof getMarketplaceSyncRun>> | { [key: string]: any; tasks: any[] }) {
  return {
    id: run.id,
    platform: run.platform,
    shopId: run.shopId,
    syncType: run.syncType,
    status: run.status,
    input: run.input,
    lastError: run.lastError,
    errors: run.errors,
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    tasks: run.tasks.map((task) => ({ id: task.id, stream: task.stream, status: task.status, attempts: task.attempts, checkpoint: task.checkpoint, metrics: task.metrics, lastError: task.lastError, errors: task.errors, nextAttemptAt: iso(task.nextAttemptAt), startedAt: iso(task.startedAt), completedAt: iso(task.completedAt) })),
  };
}

export { taskStatuses, TASK_LEASE_MS };
