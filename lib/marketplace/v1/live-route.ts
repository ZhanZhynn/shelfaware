import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { classifyLiveProviderError, listMarketplaceLive, MarketplaceLiveNotFoundError, MarketplaceLiveProviderError, MarketplaceLiveValidationError, parseLiveQuery, type LiveResource } from "./live";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

export async function liveMarketplaceGet(resource: LiveResource, request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const fail = (code: string, message: string, status: number, details?: Record<string, unknown>) => NextResponse.json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
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
    return NextResponse.json({ apiVersion: "2026-marketplace-v1", ...result, meta: { requestId, platform, source: "live", asOf: new Date().toISOString() } }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof MarketplaceLiveValidationError) return fail("INVALID_QUERY", error.message, 422);
    if (error instanceof MarketplaceLiveNotFoundError) return fail("NOT_FOUND", "Shop not found", 404);
    const providerError = error instanceof MarketplaceLiveProviderError ? error : classifyLiveProviderError(error);
    return fail(providerError.code, "Live provider request could not be completed", providerError.code === "LIVE_PROVIDER_AUTH_REQUIRED" ? 403 : ["LIVE_PROVIDER_UNSUPPORTED", "LIVE_PROVIDER_INVALID_QUERY"].includes(providerError.code) ? 422 : 502, { platform, retryable: providerError.retryable, retryAfterSeconds: providerError.retryAfterSeconds ?? null, providerCode: providerError.provider?.code ?? null, providerRequestId: providerError.provider?.requestId ?? null, guidance: providerError.code === "LIVE_PROVIDER_AUTH_REQUIRED" ? "Reconnect the marketplace shop and confirm its provider permissions." : providerError.code === "LIVE_PROVIDER_INVALID_QUERY" ? "Review the provider date window and supported filters." : providerError.retryable ? "Retry after the suggested delay." : "This live query is not available for this provider or request." });
  }
}
