import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { parseSlaQuery, SlaError, slaPlatforms, type SlaPlatform } from "@/lib/marketplace/sla/domain";
import { getSlaReport } from "@/lib/marketplace/sla/report";
import { classifyLiveProviderError } from "./live";

export async function slaMarketplaceGet(request: NextRequest, platform: string, view: "orders" | "summary") {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  const fail = (code: string, message: string, status: number, details?: Record<string, unknown>) => NextResponse.json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers });
  if (!slaPlatforms.includes(platform as SlaPlatform)) return fail("NOT_FOUND", "SLA reporting supports Shopee, Lazada and TikTok", 404);
  try {
    const query = parseSlaQuery(new URL(request.url).searchParams);
    const actor = await requireApiActor(request, query.live ? ["marketplace:read", "marketplace:live"] : ["marketplace:read"]);
    const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
    if (limited) return limited;
    try {
      return NextResponse.json({ apiVersion: "2026-marketplace-sla-v1", requestId, ...await getSlaReport(actor.user, platform as SlaPlatform, query, view) }, { headers });
    } catch (error) {
      if (error instanceof SlaError) throw error;
      if (!query.live) throw error;
      const provider = classifyLiveProviderError(error);
      return fail(provider.code, "Live fulfillment collection failed", provider.code === "LIVE_PROVIDER_AUTH_REQUIRED" ? 403 : 502, { retryAfterSeconds: provider.retryAfterSeconds ?? null, retryable: provider.retryable });
    }
  } catch (error) {
    if (error instanceof ApiScopeError) return fail("FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return fail("UNAUTHORIZED", "Unauthorized", 401);
    if (error instanceof SlaError) return fail(error.code, error.message, error.status, { retryable: error.retryable });
    return fail("INTERNAL_ERROR", "SLA reporting failed", 500);
  }
}
