import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getProfitDetail } from "@/lib/marketplace/analytics/profit-detail";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const respondError = (code: string, message: string, status: number) =>
    NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });

  const limited = await withRateLimit(request, defaultRateLimits.standard);
  if (limited) return limited;

  const session = await getSessionFromRequest(request);
  if (!session) return respondError("UNAUTHORIZED", "Unauthorized", 401);

  const params = new URL(request.url).searchParams;
  const platform = params.get("platform") as MarketplacePlatform | null;
  if (!platform || !platforms.has(platform)) return respondError("INVALID_QUERY", "platform is required and must be shopee, lazada, tiktok, or shopify.", 422);

  try {
    const result = await getProfitDetail(platform, session, params);
    return NextResponse.json(result, { headers: { "x-request-id": requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profit detail request failed";
    if (message.includes("unavailable") || message.includes("Unsupported")) return respondError("NOT_FOUND", message, 404);
    return respondError("INTERNAL_ERROR", message, 500);
  }
}
