import { NextRequest, NextResponse } from "next/server";
import { marketplaceStatsResponse } from "@/lib/marketplace/analytics/http";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) { const { platform } = await params; return platforms.has(platform as MarketplacePlatform) ? marketplaceStatsResponse(request, platform as MarketplacePlatform) : NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }); }
