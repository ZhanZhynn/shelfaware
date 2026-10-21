import { NextRequest, NextResponse } from "next/server";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { executeMarketplaceSyncForeground } from "@/lib/marketplace/sync-foreground";
import { MarketplaceSyncExecutionConflictError } from "@/lib/marketplace/sync-execution";
import { MarketplaceSyncRunNotFoundError, marketplaceSyncRunResponse } from "@/lib/marketplace/sync-runs";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

export const runtime = "nodejs";
export const maxDuration = 240;

const platforms = new Set(["shopee", "lazada", "tiktok", "shopify"]);
const objectId = /^[a-f\d]{24}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ platform: string; id: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message, requestId } }, { status, headers });
  const { platform, id } = await params;
  if (!platforms.has(platform) || !objectId.test(id)) return fail("NOT_FOUND", "Sync run not found", 404);

  let actor;
  try {
    actor = await requireApiActor(request, ["marketplace:sync"]);
  } catch (error) {
    if (error instanceof ApiScopeError) return fail("FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return fail("UNAUTHORIZED", "Unauthorized", 401);
    return fail("INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;
  try {
    const { run, ...progress } = await executeMarketplaceSyncForeground(platform as MarketplacePlatform, id, actor.user, new URL(request.url).origin);
    return NextResponse.json({ apiVersion: "2026-marketplace-v1", data: marketplaceSyncRunResponse(run), meta: { requestId, platform, execution: "foreground", ...progress } }, { headers });
  } catch (error) {
    if (error instanceof MarketplaceSyncRunNotFoundError) return fail("NOT_FOUND", "Sync run not found", 404);
    if (error instanceof MarketplaceSyncExecutionConflictError) return fail("SYNC_EXECUTION_CONFLICT", error.message, 409);
    return fail("INTERNAL_ERROR", "Foreground sync step failed", 500);
  }
}
