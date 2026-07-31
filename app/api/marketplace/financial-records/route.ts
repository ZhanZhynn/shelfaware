import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const platform = params.get("platform");
  const shopId = params.get("shopId");
  if (!platform || !platforms.has(platform as MarketplacePlatform) || !shopId) return NextResponse.json({ error: { code: "INVALID_QUERY", message: "platform and shopId are required." } }, { status: 422 });
  const shops = await accessibleMarketplaceShops(session, platform as MarketplacePlatform);
  if (!shops.some((shop) => shop.id === shopId)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Selected shop is unavailable." } }, { status: 403 });
  const where = { platform, shopId };
  const [total, records] = await Promise.all([
    prisma.marketplaceFinancialRecord.count({ where }),
    prisma.marketplaceFinancialRecord.findMany({ where, orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }], take: 25, select: { id: true, externalId: true, orderExternalId: true, transactionType: true, feeType: true, feeName: true, amountMinor: true, amountScale: true, currency: true, occurredAt: true, sourceObservedAt: true, financialQuality: true, unknownReason: true } }),
  ]);
  return NextResponse.json({ total, records });
}
