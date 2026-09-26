import { Prisma } from "@prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { prisma } from "@/prisma/client";
import type { MarketplacePlatform } from "./analytics/types";

export const marketplaceSyncTypes = ["products", "orders", "finance", "returns", "ads", "payouts", "all"] as const;
export const marketplaceSyncJobStatuses = ["pending", "running", "retrying", "completed", "failed", "cancelled"] as const;
export const MAX_MARKETPLACE_SYNC_ATTEMPTS = 5;

export type MarketplaceSyncType = (typeof marketplaceSyncTypes)[number];
export type MarketplaceSyncJobStatus = (typeof marketplaceSyncJobStatuses)[number];
export type MarketplaceSyncInput = Prisma.InputJsonObject;

export class MarketplaceSyncJobNotFoundError extends Error {}

type MarketplaceActor = Parameters<typeof marketplaceOwnerIds>[0];
type MarketplaceSyncJobRecord = {
  id: string;
  platform: string;
  shopId: string;
  syncType: string;
  requestedByUserId: string;
  idempotencyKey: string | null;
  input: Prisma.JsonValue | null;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attempts: number;
  lastError: string | null;
  errors: Prisma.JsonValue | null;
  nextAttemptAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ownedShop = async (platform: MarketplacePlatform, shopId: string, ownerIds: string[]) => {
  const where = { id: shopId, userId: { in: ownerIds } };
  if (platform === "shopee") return prisma.shopeeShop.findFirst({ where, select: { id: true } });
  if (platform === "lazada") return prisma.lazadaShop.findFirst({ where, select: { id: true } });
  if (platform === "tiktok") return prisma.tikTokShop.findFirst({ where, select: { id: true } });
  return prisma.shopifyShop.findFirst({ where, select: { id: true } });
};

/** Uses the same shared-admin owner scope as existing marketplace routes. */
export async function assertMarketplaceSyncShop(platform: MarketplacePlatform, shopId: string, actor: MarketplaceActor) {
  const ownerIds = await marketplaceOwnerIds(actor);
  const shop = await ownedShop(platform, shopId, ownerIds);
  if (!shop) throw new MarketplaceSyncJobNotFoundError("Shop not found");
  return shop;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function isMarketplaceSyncType(value: string): value is MarketplaceSyncType {
  return (marketplaceSyncTypes as readonly string[]).includes(value);
}

/**
 * One active durable identity exists for a platform/shop/sync-type tuple. This
 * deliberately coalesces duplicate requests even when they arrive concurrently.
 */
export async function createMarketplaceSyncJob(input: {
  platform: MarketplacePlatform;
  shopId: string;
  syncType: MarketplaceSyncType;
  requestedByUserId: string;
  idempotencyKey?: string;
  input?: MarketplaceSyncInput;
}): Promise<{ job: MarketplaceSyncJobRecord; coalesced: boolean }> {
  const where = { platform_shopId_syncType: { platform: input.platform, shopId: input.shopId, syncType: input.syncType } };
  const existing = await prisma.marketplaceSyncJob.findUnique({ where });
  if (existing) return { job: existing, coalesced: true };

  try {
    const job = await prisma.marketplaceSyncJob.create({
      data: {
        platform: input.platform,
        shopId: input.shopId,
        syncType: input.syncType,
        requestedByUserId: input.requestedByUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        input: input.input ?? null,
      },
    });
    return { job, coalesced: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const job = await prisma.marketplaceSyncJob.findUnique({ where });
    if (!job) throw error;
    return { job, coalesced: true };
  }
}

/** Conditionally claims a lease without using process-local locks. */
export async function claimMarketplaceSyncJob(id: string, workerId: string, now = new Date(), leaseMs = 60_000) {
  // A crashed final attempt cannot be retried forever. This conditional update
  // also leaves a live lease untouched.
  await prisma.marketplaceSyncJob.updateMany({
    where: { id, status: "running", attempts: { gte: MAX_MARKETPLACE_SYNC_ATTEMPTS }, leaseExpiresAt: { lte: now } },
    data: { status: "failed", completedAt: now, lastError: "ATTEMPTS_EXHAUSTED", leaseOwner: null, leaseExpiresAt: null },
  });
  const result = await prisma.marketplaceSyncJob.updateMany({
    where: {
      id,
      status: { in: ["pending", "retrying", "running"] },
      attempts: { lt: MAX_MARKETPLACE_SYNC_ATTEMPTS },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      startedAt: now,
      nextAttemptAt: null,
    },
  });
  return result.count === 1;
}

/** A worker can extend only a lease it still owns. */
export async function renewMarketplaceSyncLease(id: string, workerId: string, now = new Date(), leaseMs = 60_000) {
  const result = await prisma.marketplaceSyncJob.updateMany({
    where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return result.count === 1;
}

/** Completion is rejected after ownership is lost or the lease expires. */
export async function completeMarketplaceSyncJob(id: string, workerId: string, now = new Date()) {
  const result = await prisma.marketplaceSyncJob.updateMany({
    where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
    data: { status: "completed", completedAt: now, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, lastError: null },
  });
  return result.count === 1;
}

/** Persist only stable error codes; provider exception messages may contain sensitive data. */
export function marketplaceSyncErrorCode(value: string) {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "SYNC_ATTEMPT_FAILED";
}

export function marketplaceSyncRetryAt(attempt: number, now = new Date(), random = Math.random) {
  const seconds = Math.min(30 * 60, 30 * 2 ** Math.max(0, attempt - 1) * (0.75 + random() * 0.5));
  return new Date(now.getTime() + Math.round(seconds) * 1000);
}

/** Releases a worker's live lease and schedules an exponential retry or terminal failure. */
export async function retryMarketplaceSyncJob(id: string, workerId: string, error: string, now = new Date()) {
  const job = await prisma.marketplaceSyncJob.findFirst({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } } });
  if (!job) return false;

  const code = marketplaceSyncErrorCode(error);
  const exhausted = job.attempts >= MAX_MARKETPLACE_SYNC_ATTEMPTS;
  const errors = Array.isArray(job.errors) ? job.errors.slice(-4) : [];
  errors.push({ at: now.toISOString(), code });
  const result = await prisma.marketplaceSyncJob.updateMany({
    where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
    data: {
      status: exhausted ? "failed" : "retrying",
      completedAt: exhausted ? now : null,
      nextAttemptAt: exhausted ? null : marketplaceSyncRetryAt(job.attempts, now),
      lastError: code,
      errors: errors as Prisma.InputJsonArray,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return result.count === 1;
}

/** Fetches a job only after both requestor and current shop ownership are scoped. */
export async function getMarketplaceSyncJob(platform: MarketplacePlatform, id: string, actor: MarketplaceActor) {
  const ownerIds = await marketplaceOwnerIds(actor);
  const job = await prisma.marketplaceSyncJob.findFirst({ where: { id, platform, requestedByUserId: { in: ownerIds } } });
  if (!job || !(await ownedShop(platform, job.shopId, ownerIds))) {
    throw new MarketplaceSyncJobNotFoundError("Sync job not found");
  }
  return job;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function marketplaceSyncJobResponse(job: MarketplaceSyncJobRecord) {
  return {
    id: job.id,
    platform: job.platform,
    shopId: job.shopId,
    syncType: job.syncType,
    status: job.status,
    attempts: job.attempts,
    input: job.input,
    lastError: job.lastError,
    errors: job.errors,
    nextAttemptAt: iso(job.nextAttemptAt),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

// TODO(sync-workers): Wire a worker only after every provider uses a per-shop
// client instance. Do not enqueue QStash work against the current mutable
// module-global provider clients; the persisted lease is ready for that phase.
