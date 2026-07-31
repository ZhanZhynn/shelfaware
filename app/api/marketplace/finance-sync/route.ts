import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { syncLazadaFinance } from "@/lib/lazada";
import { syncTikTokFinance } from "@/lib/tiktok";
import { syncShopifyFinance } from "@/lib/shopify";
import { syncShopeeOrders } from "@/lib/shopee";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { linkMarketplaceFinancialRecords } from "@/lib/server/marketplace-financial-links";
import { reconcileLazadaPayoutStatements } from "@/lib/server/lazada-reconciliation";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const body = await request.json().catch(() => null) as { platform?: string; shopId?: string } | null;
  if (!body?.platform || !platforms.has(body.platform as MarketplacePlatform) || !body.shopId) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Select one marketplace shop before syncing financial data." } }, { status: 422 });

  const platform = body.platform as MarketplacePlatform;
  const ownerIds = await marketplaceOwnerIds(session);
  try {
    let result: unknown;
    let reconciliation: unknown = null;
    if (platform === "lazada") {
      const shop = await prisma.lazadaShop.findFirst({ where: { id: body.shopId, userId: { in: ownerIds } }, select: { sellerId: true, userId: true } });
      if (!shop) throw new Error("Selected Lazada shop is unavailable.");
      result = await syncLazadaFinance(shop.sellerId, shop.userId, undefined, session.id);
      reconciliation = await reconcileLazadaPayoutStatements({ userId: shop.userId, shopId: body.shopId });
    } else if (platform === "tiktok") {
      const shop = await prisma.tikTokShop.findFirst({ where: { id: body.shopId, userId: { in: ownerIds } }, select: { shopId: true, userId: true } });
      if (!shop) throw new Error("Selected TikTok Shop is unavailable.");
      result = await syncTikTokFinance(shop.shopId, shop.userId, session.id);
    } else if (platform === "shopify") {
      const shop = await prisma.shopifyShop.findFirst({ where: { id: body.shopId, userId: { in: ownerIds } }, select: { id: true, userId: true } });
      if (!shop) throw new Error("Selected Shopify shop is unavailable.");
      result = await syncShopifyFinance(shop.id, shop.userId, undefined, session.id);
    } else {
      const shop = await prisma.shopeeShop.findFirst({ where: { id: body.shopId, userId: { in: ownerIds } }, select: { shopId: true, userId: true } });
      if (!shop) throw new Error("Selected Shopee shop is unavailable.");
      result = await syncShopeeOrders(shop.shopId, shop.userId, undefined, undefined, session.id);
    }
    const links = await linkMarketplaceFinancialRecords(platform, body.shopId);
    await invalidateMarketplaceAnalytics(platform);
    return NextResponse.json({ result, links, reconciliation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: { code: "FINANCE_SYNC_FAILED", message } }, { status: 502 });
  }
}
