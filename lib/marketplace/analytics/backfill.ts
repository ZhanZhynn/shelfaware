import { prisma } from "@/prisma/client";
import { invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { ensureMarketplaceAnalyticsConnection } from "./capabilities";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import type { MarketplacePlatform } from "./types";

export const backfillStreams = ["orders", "refunds", "finance", "settlements"] as const;
export const backfillStates = ["pending", "running", "retrying", "completed", "failed", "cancelled"] as const;
export type BackfillStream = typeof backfillStreams[number];
export type BackfillState = typeof backfillStates[number];

export function nextBackfillState(state: BackfillState, event: "claim" | "checkpoint" | "retry" | "complete" | "fail" | "cancel"): BackfillState {
  const transitions: Record<BackfillState, Partial<Record<typeof event, BackfillState>>> = {
    pending: { claim: "running", cancel: "cancelled" }, running: { checkpoint: "running", retry: "retrying", complete: "completed", fail: "failed", cancel: "cancelled" },
    retrying: { claim: "running", cancel: "cancelled" }, completed: {}, failed: {}, cancelled: {},
  };
  const next = transitions[state][event];
  if (!next) throw new Error(`Invalid backfill transition ${state} -> ${event}`);
  return next;
}

export function backfillRetryAt(attempt: number, now = new Date(), random = Math.random) {
  const seconds = Math.min(60 * 30, 30 * 2 ** Math.max(0, attempt - 1) * (0.75 + random() * 0.5));
  return new Date(now.getTime() + Math.round(seconds) * 1000);
}

/** Creates one idempotent stream boundary. Execution remains intentionally disabled pending source validation. */
export async function ensureBackfill(input: { userId: string; platform: MarketplacePlatform; shopId: string; stream: BackfillStream; windowStart?: Date; windowEnd?: Date; maxAttempts?: number }) {
  const connection = await ensureMarketplaceAnalyticsConnection(input);
  const maxAttempts = Math.min(Math.max(1, input.maxAttempts ?? 5), 5);
  return prisma.marketplaceAnalyticsBackfill.upsert({ where: { platform_shopId_stream: { platform: input.platform, shopId: input.shopId, stream: input.stream } }, create: { ...input, connectionId: connection.id, maxAttempts }, update: { connectionId: connection.id, windowStart: input.windowStart, windowEnd: input.windowEnd, maxAttempts } });
}

/** Authorized orchestration entrypoint. It only queues the ORDER stream; it never calls remote finance APIs. */
export async function requestOrderBackfill(session: Parameters<typeof accessibleMarketplaceShops>[0], platform: MarketplacePlatform, shopId: string, windowStart?: Date, windowEnd?: Date) {
  const shop = (await accessibleMarketplaceShops(session, platform)).find((candidate) => candidate.id === shopId);
  if (!shop) throw new Error("Selected shop is unavailable");
  const connection = platform === "shopee" ? await prisma.shopeeShop.findUnique({ where: { id: shopId }, select: { userId: true } })
    : platform === "lazada" ? await prisma.lazadaShop.findUnique({ where: { id: shopId }, select: { userId: true } })
      : platform === "tiktok" ? await prisma.tikTokShop.findUnique({ where: { id: shopId }, select: { userId: true } })
        : await prisma.shopifyShop.findUnique({ where: { id: shopId }, select: { userId: true } });
  if (!connection) throw new Error("Selected shop is unavailable");
  return ensureBackfill({ userId: connection.userId, platform, shopId, stream: "orders", windowStart, windowEnd });
}

/** Atomic conditional update makes ownership safe across Mongo workers without holding a process-local lock. */
export async function claimBackfill(id: string, workerId: string, now = new Date(), leaseMs = 60_000) {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { id, status: { in: ["pending", "retrying", "running"] }, retryCount: { lt: 5 }, AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }] }] }, data: { status: "running", leaseOwner: workerId, leaseExpiresAt, claimedAt: now, lastAttemptAt: now } });
  return claimed.count === 1;
}

export async function completeBackfill(id: string, workerId: string) {
  const job = await prisma.marketplaceAnalyticsBackfill.findFirst({ where: { id, status: "running", leaseOwner: workerId }, select: { platform: true } });
  if (!job) return false;
  const result = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { id, status: "running", leaseOwner: workerId }, data: { status: "completed", completedAt: new Date(), nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null, error: null, terminalReason: null } });
  if (result.count) await invalidateMarketplaceAnalytics(job.platform as MarketplacePlatform);
  return result.count === 1;
}

export async function checkpointBackfill(id: string, workerId: string, cursor: object | null, counts: { pages?: number; items?: number } = {}) {
  const result = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { id, status: "running", leaseOwner: workerId }, data: { cursor: cursor ?? undefined, checkpointAt: new Date(), pageCount: { increment: counts.pages ?? 0 }, itemCount: { increment: counts.items ?? 0 } } });
  return result.count === 1;
}

/** A worker may extend only its own live lease; this does not execute a remote call. */
export async function renewBackfillLease(id: string, workerId: string, now = new Date(), leaseMs = 60_000) {
  const result = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { id, status: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) } });
  return result.count === 1;
}

export async function cancelBackfill(session: Parameters<typeof accessibleMarketplaceShops>[0], platform: MarketplacePlatform, shopId: string) {
  const shop = (await accessibleMarketplaceShops(session, platform)).find((candidate) => candidate.id === shopId);
  if (!shop) throw new Error("Selected shop is unavailable");
  const result = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { platform, shopId, stream: "orders", status: { in: ["pending", "retrying", "running"] } }, data: { status: "cancelled", terminalReason: "operator_cancelled", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null } });
  return result.count === 1;
}

/** Credential-free runner boundary: callers receive checkpoints but no platform client. */
export type OrderBackfillRunner = (job: { id: string; platform: MarketplacePlatform; shopId: string; cursor: unknown; windowStart: Date | null; windowEnd: Date | null }, checkpoint: (cursor: object | null, counts?: { pages?: number; items?: number }) => Promise<boolean>) => Promise<void>;

export async function retryBackfill(id: string, workerId: string, error: string, now = new Date()) {
  const job = await prisma.marketplaceAnalyticsBackfill.findFirst({ where: { id, status: "running", leaseOwner: workerId } });
  if (!job) return false;
  const exhausted = job.retryCount + 1 >= job.maxAttempts;
  const result = await prisma.marketplaceAnalyticsBackfill.updateMany({ where: { id, status: "running", leaseOwner: workerId }, data: { status: exhausted ? "failed" : "retrying", retryCount: { increment: 1 }, nextAttemptAt: exhausted ? null : backfillRetryAt(job.retryCount + 1, now), error, terminalReason: exhausted ? "retry_exhausted" : null, leaseOwner: null, leaseExpiresAt: null } });
  return result.count === 1;
}
