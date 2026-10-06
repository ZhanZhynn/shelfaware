import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import {
  assertMarketplaceSyncShop,
  createMarketplaceSyncJob,
  marketplaceSyncJobResponse,
  marketplaceSyncTypes,
  type MarketplaceSyncInput,
  MarketplaceSyncJobNotFoundError,
} from "@/lib/marketplace/sync-jobs";
import { enqueueMarketplaceSyncJob } from "@/lib/marketplace/sync-enqueue";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const objectId = /^[a-f\d]{24}$/i;
const bodySchema = z.object({
  shopId: z.string().regex(objectId, "shopId must be an internal shop ID"),
  syncType: z.enum(marketplaceSyncTypes),
  input: z.record(z.unknown()).optional(),
}).strict();

function failure(requestId: string, code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { platform } = await params;
  if (!platforms.has(platform as MarketplacePlatform)) return failure(requestId, "NOT_FOUND", "Not found", 404);

  let actor;
  try {
    actor = await requireApiActor(request, ["marketplace:sync"]);
  } catch (error) {
    if (error instanceof ApiScopeError) return failure(requestId, "FORBIDDEN", "Forbidden", 403);
    if (error instanceof ApiTokenAuthenticationError) return failure(requestId, "UNAUTHORIZED", "Unauthorized", 401);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) return limited;

  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  if (idempotencyKey && !/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
    return failure(requestId, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 1-128 URL-safe characters", 422);
  }
  let payload: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(contentLength) || contentLength > 16_384) return failure(requestId, "INVALID_BODY", "Request body is too large", 422);
    payload = await request.json();
  } catch {
    return failure(requestId, "INVALID_BODY", "Invalid JSON body", 422);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return failure(requestId, "INVALID_BODY", "shopId and syncType are required", 422);
  try {
    const body = parsed.data;
    await assertMarketplaceSyncShop(platform as MarketplacePlatform, body.shopId, actor.user);
    const result = await createMarketplaceSyncJob({
      platform: platform as MarketplacePlatform,
      shopId: body.shopId,
      syncType: body.syncType,
      requestedByUserId: actor.user.id,
      idempotencyKey,
      input: body.input as MarketplaceSyncInput | undefined,
    });
    // This only publishes durable work. It intentionally never falls back to a
    // provider call in the API request when QStash is unavailable.
    const queued = await enqueueMarketplaceSyncJob(result.job.id, {
      notBefore: result.job.nextAttemptAt ?? undefined,
    });
    return NextResponse.json(
      {
        apiVersion: "2026-marketplace-v1",
        data: marketplaceSyncJobResponse(result.job),
        meta: { requestId, platform, execution: queued.scheduled ? "scheduled" : "pending", coalesced: result.coalesced },
      },
      { status: 202, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MarketplaceSyncJobNotFoundError) return failure(requestId, "NOT_FOUND", "Shop not found", 404);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
}
