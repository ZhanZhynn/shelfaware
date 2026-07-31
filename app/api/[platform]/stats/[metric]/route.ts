import { NextRequest, NextResponse } from "next/server";
import { marketplaceStatsResponse } from "@/lib/marketplace/analytics/http";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const metrics = new Set(["revenue-trend", "products", "buyers", "clv", "profit"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string; metric: string }> }) {
  const { platform, metric } = await params;
  if (!platforms.has(platform as MarketplacePlatform) || !metrics.has(metric)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  return marketplaceStatsResponse(request, platform as MarketplacePlatform, metric);
}
