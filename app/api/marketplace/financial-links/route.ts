import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { linkMarketplaceFinancialRecords } from "@/lib/server/marketplace-financial-links";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const body = await request.json().catch(() => null) as { platform?: string; shopId?: string } | null;
  if (!body?.platform || !platforms.has(body.platform as MarketplacePlatform) || !body.shopId) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "platform and shopId are required." } }, { status: 422 });
  const platform = body.platform as MarketplacePlatform;
  if (!(await accessibleMarketplaceShops(session, platform)).some((shop) => shop.id === body.shopId)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Selected shop is unavailable." } }, { status: 403 });
  return NextResponse.json({ result: await linkMarketplaceFinancialRecords(platform, body.shopId) });
}
