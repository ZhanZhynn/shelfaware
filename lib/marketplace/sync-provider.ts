import { prisma } from "@/prisma/client";
import { syncShopeeAds, syncShopeeAll, syncShopeeOrders, syncShopeePayoutStatements, syncShopeeProducts, syncShopeeReturns } from "@/lib/shopee";
import { syncLazadaAll, syncLazadaFinance, syncLazadaOrders, syncLazadaPayoutStatements, syncLazadaProducts } from "@/lib/lazada";
import { syncTikTokAll, syncTikTokFinance, syncTikTokOrders, syncTikTokPayoutStatements, syncTikTokProducts } from "@/lib/tiktok";
import { syncShopifyAll, syncShopifyFinance, syncShopifyOrders, syncShopifyProducts } from "@/lib/shopify";
import type { MarketplacePlatform } from "./analytics/types";
import { marketplaceSyncDateRange } from "./sync-jobs";

export class PermanentDispatchError extends Error {
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
  const range = marketplaceSyncDateRange(input);
  const days = daysBack(input);
  const [defaultTimeFrom, defaultTimeTo] = secondsRange(days);
  const timeFrom = range?.timeFrom ?? defaultTimeFrom;
  const timeTo = range?.timeTo ?? defaultTimeTo;
  switch (syncType) {
    case "products": return syncShopeeProducts(shop.shopId, shop.userId, actorId);
    case "orders": return syncShopeeOrders(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    // Shopee financial rows are collected while syncing order escrow details.
    case "finance": return syncShopeeOrders(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    case "returns": return syncShopeeReturns(shop.shopId, shop.userId, timeFrom, timeTo, actorId);
    case "ads": return syncShopeeAds(shop.shopId, shop.userId, days, actorId);
    case "payouts": return range
      ? syncShopeePayoutStatements(shop.shopId, shop.userId, { timeFrom: range.timeFrom, timeTo: range.timeTo }, actorId)
      : syncShopeePayoutStatements(shop.shopId, shop.userId, days, actorId);
    case "all": return syncShopeeAll(shop.shopId, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runLazada(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.lazadaShop.findUnique({ where: { id: shopId }, select: { sellerId: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const range = marketplaceSyncDateRange(input);
  const after = range ? { from: range.dateFrom, to: range.dateTo } : createdAfter(daysBack(input));
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
  const range = marketplaceSyncDateRange(input);
  const [after] = secondsRange(days);
  switch (syncType) {
    case "products": return syncTikTokProducts(shop.shopId, shop.userId, actorId);
    case "orders": return syncTikTokOrders(shop.shopId, shop.userId, range ? { from: range.timeFrom, to: range.timeTo } : after, actorId);
    case "finance": return range
      ? syncTikTokFinance(shop.shopId, shop.userId, actorId, { from: range.timeFrom, to: range.timeTo })
      : syncTikTokFinance(shop.shopId, shop.userId, actorId);
    case "payouts": return syncTikTokPayoutStatements(shop.shopId, shop.userId, actorId);
    case "all": return syncTikTokAll(shop.shopId, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

async function runShopify(shopId: string, actorId: string, syncType: string, input: unknown) {
  const shop = await prisma.shopifyShop.findUnique({ where: { id: shopId }, select: { id: true, userId: true } });
  if (!shop) throw new PermanentDispatchError("SHOP_NOT_FOUND");
  const days = daysBack(input);
  const range = marketplaceSyncDateRange(input);
  const scope = range ? { from: range.dateFrom, to: range.dateTo } : days;
  switch (syncType) {
    case "products": return syncShopifyProducts(shop.id, shop.userId, actorId);
    case "orders": return syncShopifyOrders(shop.id, shop.userId, scope, actorId);
    case "finance": return syncShopifyFinance(shop.id, shop.userId, scope, actorId);
    case "all": return syncShopifyAll(shop.id, shop.userId, actorId);
    default: throw new PermanentDispatchError("SYNC_TYPE_UNSUPPORTED");
  }
}

/** Shared provider resolution for legacy jobs and checkpointed stream tasks. */
export async function runMarketplaceSync(platform: MarketplacePlatform, shopId: string, actorId: string, syncType: string, input: unknown) {
  if (syncType === "orders_and_escrow") syncType = "orders";
  if (platform === "shopee") return runShopee(shopId, actorId, syncType, input);
  if (platform === "lazada") return runLazada(shopId, actorId, syncType, input);
  if (platform === "tiktok") return runTikTok(shopId, actorId, syncType, input);
  return runShopify(shopId, actorId, syncType, input);
}
