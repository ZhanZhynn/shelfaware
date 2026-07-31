import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceReconciliationStatus } from "@/lib/marketplace/analytics/reconciliation-status";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const platform = params.get("platform");
  const shopId = params.get("shopId");
  if (!platform || !platforms.has(platform as MarketplacePlatform) || !shopId) {
    return NextResponse.json({ error: { code: "INVALID_QUERY", message: "platform and shopId are required." } }, { status: 422 });
  }

  const shops = await accessibleMarketplaceShops(session, platform as MarketplacePlatform);
  if (!shops.some((shop) => shop.id === shopId)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Selected shop is unavailable." } }, { status: 403 });
  }

  return NextResponse.json(await getMarketplaceReconciliationStatus(platform as MarketplacePlatform, shopId));
}
