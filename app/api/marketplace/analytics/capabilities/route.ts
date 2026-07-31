import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceCapabilities, getMarketplaceFinancialReadiness } from "@/lib/marketplace/analytics/capabilities";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: { code: "FORBIDDEN", message: "Operator access required" } }, { status: 403 });
  const platform = request.nextUrl.searchParams.get("platform") as MarketplacePlatform;
  if (!platforms.has(platform)) return NextResponse.json({ error: { code: "INVALID_QUERY", message: "platform is required" } }, { status: 422 });
  const shops = await accessibleMarketplaceShops(session, platform);
  const requestedShopId = request.nextUrl.searchParams.get("shopId");
  const selected = requestedShopId ? shops.filter((shop) => shop.id === requestedShopId) : shops;
  if (requestedShopId && !selected.length) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Selected shop is unavailable" } }, { status: 403 });
  const shopIds = selected.map((shop) => shop.id);
  return NextResponse.json({ platform, shops: selected.map(({ externalId: _externalId, ...shop }) => shop), capabilities: await getMarketplaceCapabilities(platform, shopIds), financialReadiness: await getMarketplaceFinancialReadiness(platform, shopIds) });
}
