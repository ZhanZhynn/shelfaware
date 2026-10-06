import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { listMarketplaceLive, MarketplaceLiveNotFoundError, MarketplaceLiveValidationError, parseLiveQuery, type LiveResource } from "./live";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function liveMarketplaceGet(resource: LiveResource, request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  const { platform } = await params;
  if (!platforms.has(platform as MarketplacePlatform)) return fail("NOT_FOUND", "Not found", 404);
  let actor;
  try { actor = await requireApiActor(request, ["marketplace:live"]); } catch (error) {
    if (error instanceof ApiScopeError) return fail("FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return fail("UNAUTHORIZED", "Unauthorized", 401);
    return fail("INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;
  try {
    const query = parseLiveQuery(new URL(request.url).searchParams, resource);
    const result = await listMarketplaceLive(platform as MarketplacePlatform, actor.user, resource, query);
    return NextResponse.json({ apiVersion: "2026-marketplace-v1", ...result, meta: { requestId, platform, source: "live" } }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof MarketplaceLiveValidationError) return fail("INVALID_QUERY", error.message, 422);
    if (error instanceof MarketplaceLiveNotFoundError) return fail("NOT_FOUND", "Shop not found", 404);
    return fail("LIVE_PROVIDER_UNAVAILABLE", "Live provider unavailable", 502);
  }
}
