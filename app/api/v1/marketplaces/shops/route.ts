import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { accessibleMarketplaceShops, marketplaceShopOption } from "@/lib/marketplace/shops";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const error = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });
  let actor;
  try {
    actor = await requireApiActor(request, ["marketplace:read"]);
  } catch (cause) {
    if (cause instanceof ApiScopeError) return error("FORBIDDEN", "Forbidden", 403);
    if (cause instanceof ApiTokenAuthenticationError) return error("UNAUTHORIZED", "Unauthorized", 401);
    return error("INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;
  const platform = new URL(request.url).searchParams.get("platform");
  if (platform && !platforms.has(platform as MarketplacePlatform)) return error("INVALID_QUERY", "Invalid platform", 422);
  const shops = await accessibleMarketplaceShops(actor.user, platform as MarketplacePlatform | undefined);
  return NextResponse.json({ apiVersion: "2026-marketplace-v1", data: shops.map(marketplaceShopOption), meta: { requestId } }, { headers: { "x-request-id": requestId } });
}
