import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import type { MarketplacePlatform } from "./analytics/types";

export type MarketplaceShop = { id: string; platform: MarketplacePlatform; displayName: string; externalId: string; region: string | null; currency: string | null; connectionState: "synced" | "not-yet-synced"; lastSyncedAt: string | null };
export type MarketplaceShopOption = Omit<MarketplaceShop, "externalId">;

export function marketplaceShopOption(shop: MarketplaceShop): MarketplaceShopOption {
  const { externalId: _externalId, ...option } = shop;
  return option;
}
export function normalizePlatformShopId(platform: MarketplacePlatform, value: string) {
  const id = value.trim();
  if (!id) throw new Error("shopId is required");
  if (platform === "shopee" && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error("Invalid Shopee shop ID");
  return platform === "shopee" ? String(Number(id)) : id.toLowerCase();
}

export function observedSingleCurrencies(rows: Array<{ shopId: string; currency: string | null }>) {
  const currencies = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.currency) continue;
    let values = currencies.get(row.shopId);
    if (!values) {
      values = new Set();
      currencies.set(row.shopId, values);
    }
    values.add(row.currency);
  }
  return new Map([...currencies].map(([shopId, values]) => [shopId, values.size === 1 ? [...values][0] : null]));
}

export async function accessibleMarketplaceShops(session: Parameters<typeof marketplaceOwnerIds>[0], platform?: MarketplacePlatform): Promise<MarketplaceShop[]> {
  const ownerIds = await marketplaceOwnerIds(session);
  const [shopee, lazada, tiktok, shopify] = await Promise.all([
    !platform || platform === "shopee" ? prisma.shopeeShop.findMany({ where: { userId: { in: ownerIds } }, select: { id: true, shopId: true, shopName: true, region: true, lastSyncedAt: true } }) : [],
    !platform || platform === "lazada" ? prisma.lazadaShop.findMany({ where: { userId: { in: ownerIds } }, select: { id: true, sellerId: true, sellerName: true, countryCode: true, lastSyncedAt: true } }) : [],
    !platform || platform === "tiktok" ? prisma.tikTokShop.findMany({ where: { userId: { in: ownerIds } }, select: { id: true, shopId: true, shopName: true, region: true, lastSyncedAt: true } }) : [],
    !platform || platform === "shopify" ? prisma.shopifyShop.findMany({ where: { userId: { in: ownerIds } }, select: { id: true, shopDomain: true, shopName: true, lastSyncedAt: true } }) : [],
  ]);
  const [shopeeCurrencies, lazadaCurrencies, tiktokCurrencies, shopifyCurrencies] = await Promise.all([
    shopee.length ? prisma.shopeeOrder.findMany({ where: { shopId: { in: shopee.map((shop) => shop.id) }, currency: { not: null } }, select: { shopId: true, currency: true }, distinct: ["shopId", "currency"] }) : [],
    lazada.length ? prisma.lazadaOrder.findMany({ where: { shopId: { in: lazada.map((shop) => shop.id) }, currency: { not: null } }, select: { shopId: true, currency: true }, distinct: ["shopId", "currency"] }) : [],
    tiktok.length ? prisma.tikTokOrder.findMany({ where: { shopId: { in: tiktok.map((shop) => shop.id) }, currency: { not: null } }, select: { shopId: true, currency: true }, distinct: ["shopId", "currency"] }) : [],
    shopify.length ? prisma.shopifyOrder.findMany({ where: { shopId: { in: shopify.map((shop) => shop.id) } }, select: { shopId: true, currency: true }, distinct: ["shopId", "currency"] }) : [],
  ]);
  const shopeeCurrency = observedSingleCurrencies(shopeeCurrencies);
  const lazadaCurrency = observedSingleCurrencies(lazadaCurrencies);
  const tiktokCurrency = observedSingleCurrencies(tiktokCurrencies);
  const shopifyCurrency = observedSingleCurrencies(shopifyCurrencies);
  const state = (lastSyncedAt: Date | null) => ({ connectionState: lastSyncedAt ? "synced" as const : "not-yet-synced" as const, lastSyncedAt: lastSyncedAt?.toISOString() ?? null });
  return [...shopee.map((shop) => ({ id: shop.id, platform: "shopee" as const, displayName: shop.shopName, externalId: normalizePlatformShopId("shopee", String(shop.shopId)), region: shop.region, currency: shopeeCurrency.get(shop.id) ?? null, ...state(shop.lastSyncedAt) })), ...lazada.map((shop) => ({ id: shop.id, platform: "lazada" as const, displayName: shop.sellerName, externalId: normalizePlatformShopId("lazada", shop.sellerId), region: shop.countryCode, currency: lazadaCurrency.get(shop.id) ?? null, ...state(shop.lastSyncedAt) })), ...tiktok.map((shop) => ({ id: shop.id, platform: "tiktok" as const, displayName: shop.shopName, externalId: normalizePlatformShopId("tiktok", shop.shopId), region: shop.region, currency: tiktokCurrency.get(shop.id) ?? null, ...state(shop.lastSyncedAt) })), ...shopify.map((shop) => ({ id: shop.id, platform: "shopify" as const, displayName: shop.shopName, externalId: normalizePlatformShopId("shopify", shop.shopDomain), region: null, currency: shopifyCurrency.get(shop.id) ?? null, ...state(shop.lastSyncedAt) }))].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
