import { cacheKeys, invalidateCache, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { prisma } from "@/prisma/client";
import { syncShopeeAds, syncShopeeAll, syncShopeeOrders, syncShopeePayoutStatements, syncShopeeProducts, syncShopeeReturns } from "@/lib/shopee";
import { syncLazadaAll, syncLazadaFinance, syncLazadaOrders, syncLazadaPayoutStatements, syncLazadaProducts } from "@/lib/lazada";
import { syncTikTokAll, syncTikTokFinance, syncTikTokOrders, syncTikTokPayoutStatements, syncTikTokProducts } from "@/lib/tiktok";
import { syncShopifyAll, syncShopifyFinance, syncShopifyOrders, syncShopifyProducts } from "@/lib/shopify";
import type { MarketplacePlatform } from "./analytics/types";
import {
  claimMarketplaceSyncJob,
  completeMarketplaceSyncJob,
  failMarketplaceSyncJob,
  getClaimedMarketplaceSyncJob,
  getMarketplaceSyncJobNextAttempt,
  retryMarketplaceSyncJob,
} from "./sync-jobs";

const WORKER_LEASE_MS = 15 * 60 * 1000;
const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export type MarketplaceSyncDispatchResult =
  | { status: "skipped" }
  | { status: "completed" }
  | { status: "retrying"; nextAttemptAt: Date | null }
  | { status: "failed" };

class PermanentDispatchError extends Error {
  constructor(readonly code: "SHOP_NOT_FOUND" | "SYNC_TYPE_UNSUPPORTED") {
    super(code);
  }
}

function daysBack(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>).daysBack;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365 ? value : undefined;
}

function secondsRange(days: number | undefined) {
  if (!days) return [undefined, undefined] as const;
  const end = Math.floor(Date.now() / 1000);
  return [end - days * 24 * 60 * 60, end] as const;
}

function createdAfter(days: number | undefined) {
  return days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
}

async function runShopee(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.shopeeShop.findUnique({ where: { id: shopId }, select: { shopId: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const days = daysBack(input);
  const [timeFrom, timeTo] = secondsRange(days);
  switch (syncType) {
    case "products": return syncShopeeProducts(shop.shopId, shop.userId, actorId);
    case "orders": return syncShopeeOrders(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    // Shopee financial rows are collected while syncing order escrow details.
    case "finance": return syncShopeeOrders(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    case "returns": return syncShopeeReturns(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    case "ads": return syncShopeeAds(shop.shopId, shop.userId, days, actorId);
    case "payouts": return syncShopeePayoutStatements(shop.shopId, shop.userId, days, actorId);
    case "all": return syncShopeeAll(shop.shopId, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runLazada(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.lazadaShop.findUnique({ where: { id: shopId }, select: { sellerId: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const after = createdAfter(daysBack(input));
  switch (syncType) {
    case "products": return syncLazadaProducts(shop.sellerId, shop.userId, actorId);
    case "orders": return syncLazadaOrders(shop.sellerId, shop.userId, after, actorId);
    case "finance": return syncLazadaFinance(shop.sellerId, shop.userId, after, actorId);
    case "payouts": return syncLazadaPayoutStatements(shop.sellerId, shop.userId, after, actorId);
    case "all": return syncLazadaAll(shop.sellerId, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runTikTok(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.tikTokShop.findUnique({ where: { id: shopId }, select: { shopId: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const days = daysBack(input);
  const [after] = secondsRange(days);
  switch (syncType) {
    case "products": return syncTikTokProducts(shop.shopId, shop.userId, actorId);
    case "orders": return syncTikTokOrders(shop.shopId, shop.userId, after, actorId);
    case "finance": return syncTikTokFinance(shop.shopId, shop.userId, actorId);
    case "payouts": return syncTikTokPayoutStatements(shop.shopId, shop.userId, actorId);
    case "all": return syncTikTokAll(shop.shopId, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runShopify(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.shopifyShop.findUnique({ where: { id: shopId }, select: { id: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const days = daysBack(input);
  switch (syncType) {
    case "products": return syncShopifyProducts(shop.id, shop.userId, actorId);
    case "orders": return syncShopifyOrders(shop.id, shop.userId, days, actorId);
    case "finance": return syncShopifyFinance(shop.id, shop.userId, days, actorId);
    case "all": return syncShopifyAll(shop.id, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runMarketplaceSync(platform: MarketplacePlatform, shopId: string, actorId: string, syncType: string, input: unknown) {
  if (platform === "shopee") return runShopee(shopId, actorId, syncType, input);
  if (platform === "lazada") return runLazada(shopId, actorId, syncType, input);
  if (platform === "tiktok") return runTikTok(shopId, actorId, syncType, input);
  return runShopify(shopId, actorId, syncType, input);
}

async function invalidatePlatformCaches(platform: MarketplacePlatform) {
  await Promise.all([invalidateCache(cacheKeys[platform].pattern), invalidateMarketplaceAnalytics(platform)]);
}

/** Claim, execute and settle exactly one durable job. Provider messages never leave this service. */
export async function dispatchMarketplaceSyncJob(id: string, workerId: string, now = new Date()): Promise<MarketplaceSyncDispatchResult> {
  if (!(await claimMarketplaceSyncJob(id, workerId, now, WORKER_LEASE_MS))) return { status: "skipped" };

  const job = await getClaimedMarketplaceSyncJob(id, workerId, now);
  if (!job || !platforms.has(job.platform as MarketplacePlatform)) {
    await failMarketplaceSyncJob(id, workerId, "SYNC_TYPE_UNSUPPORTED", now);
    return { status: "failed" };
  }

  try {
    await runMarketplaceSync(job.platform as MarketplacePlatform, job.shopId, job.requestedByUserId, job.syncType, job.input);
    await invalidatePlatformCaches(job.platform as MarketplacePlatform);
    return (await completeMarketplaceSyncJob(id, workerId)) ? { status: "completed" } : { status: "skipped" };
  } catch (error) {
    if (error instanceof PermanentDispatchError) {
      await failMarketplaceSyncJob(id, workerId, error.code);
      return { status: "failed" };
    }
    const retried = await retryMarketplaceSyncJob(id, workerId, "SYNC_ATTEMPT_FAILED");
    if (!retried) return { status: "skipped" };
    const retry = await getMarketplaceSyncJobNextAttempt(id);
    return { status: "retrying", nextAttemptAt: retry?.nextAttemptAt ?? null };
  }
}
