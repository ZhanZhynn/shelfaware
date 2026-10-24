import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { AdsReportError, getShopeeAdsReport } from "@/lib/shopee/ads-report";

export async function adsMarketplaceGet(request: NextRequest, params: Promise<{ platform: string; view: string }>) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message, requestId } }, { status, headers });
  const { platform, view } = await params;
  if (platform !== "shopee") return fail("NOT_FOUND", "Ads reporting is available for Shopee", 404);
  try {
    const actor = await requireApiActor(request, ["marketplace:read"]);
    const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
    if (limited) return limited;
    const report = await getShopeeAdsReport(actor.user, new URL(request.url).searchParams, view);
    return NextResponse.json({ apiVersion: "2026-shopee-ads-v1", requestId, ...report }, { headers });
  } catch (error) {
    if (error instanceof ApiScopeError) return fail("FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return fail("UNAUTHORIZED", "Unauthorized", 401);
    if (error instanceof AdsReportError) return fail(error.code, error.message, error.status);
    return fail("INTERNAL_ERROR", "Ads reporting failed", 500);
  }
}
