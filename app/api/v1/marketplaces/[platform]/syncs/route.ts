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
import { createMarketplaceSyncRun, deliverMarketplaceSyncTaskOutbox, marketplaceSyncRunResponse } from "@/lib/marketplace/sync-runs";
import { supportsMarketplaceSync, supportsMarketplaceSyncRange } from "@/lib/marketplace/sync-plan";
import { MarketplaceSyncExecutionConflictError } from "@/lib/marketplace/sync-execution";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const objectId = /^[a-f\d]{24}$/i;
const rfc3339WithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
const dateTimeSchema = z.string().datetime({ offset: true });
const bodySchema = z.object({
  shopId: z.string().regex(objectId, "shopId must be an internal shop ID"),
  syncType: z.enum(marketplaceSyncTypes),
  executionMode: z.enum(["queued", "foreground"]).default("queued"),
  input: z.record(z.unknown()).optional(),
}).strict();

function failure(requestId: string, code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}

function dateRangeError(platform: MarketplacePlatform, syncType: string, input: Record<string, unknown> | undefined, now = Date.now()) {
  const hasDateFrom = input && Object.hasOwn(input, "dateFrom");
  const hasDateTo = input && Object.hasOwn(input, "dateTo");
  if (!hasDateFrom && !hasDateTo) return null;
  if (!supportsMarketplaceSyncRange(platform, syncType)) return "Date ranges are not supported for this platform or sync type";
  const dateFrom = input?.dateFrom;
  const dateTo = input?.dateTo;
  if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !rfc3339WithOffset.test(dateFrom) || !rfc3339WithOffset.test(dateTo) || !dateTimeSchema.safeParse(dateFrom).success || !dateTimeSchema.safeParse(dateTo).success) return "dateFrom and dateTo must be paired RFC3339 timestamps with an offset";
  const from = Date.parse(dateFrom);
  const to = Date.parse(dateTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from % 1000 !== 0 || to % 1000 !== 0) return "dateFrom and dateTo must be valid whole-second RFC3339 timestamps";
  if (from > to) return "dateFrom must be before or equal to dateTo";
  if (to > now) return "dateTo must not be in the future";
  if (to - from > maxRangeMs) return "Date ranges may not exceed 365 days";
  return null;
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
    const selectedPlatform = platform as MarketplacePlatform;
    const rangeError = dateRangeError(selectedPlatform, body.syncType, body.input);
    if (rangeError) return failure(requestId, "INVALID_DATE_RANGE", rangeError, 422);
    if (!supportsMarketplaceSync(selectedPlatform, body.syncType)) return failure(requestId, "SYNC_TYPE_UNSUPPORTED", "Sync type is not supported for this platform", 422);
    if (body.input && Object.hasOwn(body.input, "daysBack") && (!Number.isInteger(body.input.daysBack) || Number(body.input.daysBack) < 1 || Number(body.input.daysBack) > 365)) {
      return failure(requestId, "INVALID_DATE_RANGE", "daysBack must be an integer from 1 to 365", 422);
    }
    await assertMarketplaceSyncShop(platform as MarketplacePlatform, body.shopId, actor.user);
    // Every all-sync uses a task graph, regardless of whether dates were given.
    // Historical and TikTok/Shopify stream requests share the same engine.
    if (body.executionMode === "foreground" || body.syncType === "all" || ["tiktok", "shopify"].includes(platform) || (body.input && Object.hasOwn(body.input, "dateFrom"))) {
      const result = await createMarketplaceSyncRun({
        platform: selectedPlatform,
        shopId: body.shopId,
        requestedByUserId: actor.user.id,
        syncType: body.syncType,
        idempotencyKey,
        input: body.input as MarketplaceSyncInput | undefined,
        ...(body.executionMode === "foreground" ? { execution: { mode: "foreground" as const, target: new URL(request.url).origin } } : {}),
      });
      const queued = body.executionMode === "queued" && result.firstTaskId ? await deliverMarketplaceSyncTaskOutbox(result.firstTaskId) : { scheduled: false };
      return NextResponse.json(
        {
          apiVersion: "2026-marketplace-v1",
          data: marketplaceSyncRunResponse(result.run),
          meta: { requestId, platform, execution: body.executionMode === "foreground" ? "foreground" : queued.scheduled ? "scheduled" : "pending", coalesced: result.coalesced },
        },
        { status: 202, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
      );
    }
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
    if (error instanceof MarketplaceSyncExecutionConflictError) return failure(requestId, "SYNC_EXECUTION_CONFLICT", error.message, 409);
    if (error instanceof MarketplaceSyncJobNotFoundError) return failure(requestId, "NOT_FOUND", "Shop not found", 404);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
}
