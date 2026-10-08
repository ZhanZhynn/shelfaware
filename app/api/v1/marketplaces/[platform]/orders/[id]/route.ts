import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getMarketplaceOrder, MarketplaceV1NotFoundError, MarketplaceV1ValidationError, parseMarketplaceRecordId } from "@/lib/marketplace/v1/local-catalog";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

/** Returns an owned, persisted order; provider APIs are never called from this endpoint. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string; id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });
  const { platform, id } = await params;
  if (!platforms.has(platform as MarketplacePlatform)) return fail("NOT_FOUND", "Not found", 404);
  try { parseMarketplaceRecordId(id); } catch { return fail("NOT_FOUND", "Not found", 404); }
  let actor;
  try { actor = await requireApiActor(request, ["marketplace:read"]); } catch (error) {
    if (error instanceof ApiScopeError) return fail("FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return fail("UNAUTHORIZED", "Unauthorized", 401);
    return fail("INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;
  try {
    const data = await getMarketplaceOrder(platform as MarketplacePlatform, actor.user, id);
    return NextResponse.json({ apiVersion: "2026-marketplace-v1", data, meta: { requestId, platform, source: "local" } }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof MarketplaceV1ValidationError) return fail("INVALID_QUERY", error.message, 422);
    if (error instanceof MarketplaceV1NotFoundError) return fail("NOT_FOUND", error.message, 404);
    return fail("INTERNAL_ERROR", "Marketplace request failed", 500);
  }
}
