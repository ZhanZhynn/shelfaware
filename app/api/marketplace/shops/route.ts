import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { accessibleMarketplaceShops, marketplaceShopOption } from "@/lib/marketplace/shops";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const platform = new URL(request.url).searchParams.get("platform");
  if (platform && !platforms.has(platform as MarketplacePlatform)) return NextResponse.json({ error: { code: "INVALID_QUERY", message: "Invalid platform" } }, { status: 422 });
  const shops = await accessibleMarketplaceShops(session, platform as MarketplacePlatform | undefined);
  return NextResponse.json({ apiVersion: "2026-analytics-v1", shops: shops.map(marketplaceShopOption) });
}
