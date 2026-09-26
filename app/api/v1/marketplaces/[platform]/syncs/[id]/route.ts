import { NextRequest, NextResponse } from "next/server";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { getMarketplaceSyncJob, marketplaceSyncJobResponse, MarketplaceSyncJobNotFoundError } from "@/lib/marketplace/sync-jobs";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const objectId = /^[a-f\d]{24}$/i;

function failure(requestId: string, code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string; id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { platform, id } = await params;
  if (!platforms.has(platform as MarketplacePlatform)) return failure(requestId, "NOT_FOUND", "Not found", 404);
  if (!objectId.test(id)) return failure(requestId, "NOT_FOUND", "Not found", 404);

  let actor;
  try {
    actor = await requireApiActor(request, ["marketplace:read"]);
  } catch (error) {
    if (error instanceof ApiScopeError) return failure(requestId, "FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return failure(requestId, "UNAUTHORIZED", "Unauthorized", 401);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;

  try {
    const job = await getMarketplaceSyncJob(platform as MarketplacePlatform, id, actor.user);
    return NextResponse.json(
      { apiVersion: "2026-marketplace-v1", data: marketplaceSyncJobResponse(job), meta: { requestId, platform } },
      { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MarketplaceSyncJobNotFoundError) return failure(requestId, "NOT_FOUND", "Not found", 404);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
}
