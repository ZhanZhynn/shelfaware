import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { cancelBackfill, requestOrderBackfill } from "@/lib/marketplace/analytics/backfill";
import { prisma } from "@/prisma/client";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { marketplaceOperationalEvent } from "@/lib/marketplace/analytics/events";
import { invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { createHash } from "crypto";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
function operator(session: Awaited<ReturnType<typeof getSessionFromRequest>>) {
  return session && session.role === "admin";
}
const actions = new Set(["start", "retry", "cancel"]);
const maxBackfillDays = Math.min(Math.max(Number(process.env.MARKETPLACE_BACKFILL_MAX_DAYS ?? 31), 1), 31);

export function parseBackfillWindow(start: unknown, end: unknown, now = new Date()) {
  if ((start === undefined) !== (end === undefined)) throw new Error("windowStart and windowEnd must be provided together");
  if (start === undefined) return { windowStart: undefined, windowEnd: undefined };
  const parse = (value: unknown, name: string) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be a UTC calendar date (YYYY-MM-DD)`);
    const result = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error(`${name} is invalid`);
    return result;
  };
  const windowStart = parse(start, "windowStart");
  const windowEnd = parse(end, "windowEnd");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (windowStart > windowEnd) throw new Error("windowStart must not be after windowEnd");
  if (windowStart > today || windowEnd > today) throw new Error("Backfill windows cannot be in the future");
  if ((windowEnd.getTime() - windowStart.getTime()) / 86_400_000 + 1 > maxBackfillDays) throw new Error(`Backfill window must not exceed ${maxBackfillDays} days`);
  return { windowStart, windowEnd };
}

function error(requestId: string, code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });
}

export function backfillRequestFingerprint(input: { platform: MarketplacePlatform; shopId: string; stream: string; action: string; windowStart?: string; windowEnd?: string }) {
  // The key identifies a semantic request, not an evolving job state or any finance data.
  return createHash("sha256").update(JSON.stringify({ platform: input.platform, shopId: input.shopId, stream: input.stream, action: input.action, windowStart: input.windowStart ?? null, windowEnd: input.windowEnd ?? null })).digest("hex");
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const session = await getSessionFromRequest(request);
  if (!session) return error(requestId, "UNAUTHORIZED", "Unauthorized", 401);
  if (!operator(session)) return error(requestId, "FORBIDDEN", "Operator access required", 403);
  const platform = request.nextUrl.searchParams.get("platform") as MarketplacePlatform;
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!platforms.has(platform) || !shopId) return error(requestId, "INVALID_QUERY", "platform and shopId are required", 422);
  if (!(await accessibleMarketplaceShops(session, platform)).some((shop) => shop.id === shopId)) return error(requestId, "FORBIDDEN", "Selected shop is unavailable", 403);
  const job = await prisma.marketplaceAnalyticsBackfill.findUnique({ where: { platform_shopId_stream: { platform, shopId, stream: "orders" } } });
  return NextResponse.json({ job }, { headers: { "x-request-id": requestId } });
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const session = await getSessionFromRequest(request);
  if (!session) return error(requestId, "UNAUTHORIZED", "Unauthorized", 401);
  if (!operator(session)) return error(requestId, "FORBIDDEN", "Operator access required", 403);
  try {
    const body = await request.json() as { platform?: MarketplacePlatform; shopId?: string; stream?: string; action?: string; windowStart?: string; windowEnd?: string; idempotencyKey?: string };
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
    if (!body.platform || !platforms.has(body.platform) || !body.shopId || !body.action || !actions.has(body.action)) return error(requestId, "INVALID_BODY", "platform, shopId, and action (start, retry, or cancel) are required", 422);
    if (body.stream !== "orders") return error(requestId, "BACKFILL_STREAM_UNSUPPORTED", "Only the operational orders stream is supported; finance, refunds, and settlements remain externally gated.", 409);
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return error(requestId, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required", 422);
    const shops = await accessibleMarketplaceShops(session, body.platform);
    if (!shops.some((shop) => shop.id === body.shopId)) return error(requestId, "FORBIDDEN", "Selected shop is unavailable", 403);
    const window = parseBackfillWindow(body.windowStart, body.windowEnd);
    const fingerprint = backfillRequestFingerprint({ platform: body.platform, shopId: body.shopId, stream: body.stream, action: body.action, windowStart: body.windowStart, windowEnd: body.windowEnd });
    let requestRecord;
    try {
      requestRecord = await prisma.marketplaceAnalyticsBackfillRequest.create({ data: { userId: session.id, platform: body.platform, shopId: body.shopId, stream: body.stream, idempotencyKey, action: body.action, payloadFingerprint: fingerprint } });
    } catch (caught) {
      if (!(caught instanceof Error) || !("code" in caught) || caught.code !== "P2002") throw caught;
      const prior = await prisma.marketplaceAnalyticsBackfillRequest.findUnique({ where: { userId_platform_shopId_stream_idempotencyKey: { userId: session.id, platform: body.platform, shopId: body.shopId, stream: body.stream, idempotencyKey } } });
      if (!prior) throw caught;
      if (prior.payloadFingerprint !== fingerprint) return error(requestId, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request payload", 409);
      if (prior.outcome === "rejected") return error(requestId, prior.errorCode ?? "INVALID_BACKFILL_STATE", prior.errorMessage ?? "Backfill request was rejected", prior.statusCode);
      if (prior.outcome === "cancelled") return NextResponse.json({ cancelled: prior.cancelled ?? false, audit: marketplaceOperationalEvent("backfill_cancelled", "success"), replayed: true }, { headers: { "x-request-id": requestId } });
      const job = prior.jobId ? await prisma.marketplaceAnalyticsBackfill.findUnique({ where: { id: prior.jobId } }) : null;
      return NextResponse.json({ job, replayed: true, ...(prior.outcome === "processing" ? { processing: true } : {}) }, { status: prior.statusCode, headers: { "x-request-id": requestId } });
    }
    const existing = await prisma.marketplaceAnalyticsBackfill.findUnique({ where: { platform_shopId_stream: { platform: body.platform, shopId: body.shopId, stream: "orders" } } });
    if (body.action === "cancel") {
      const cancelled = await cancelBackfill(session, body.platform, body.shopId);
      await prisma.marketplaceAnalyticsBackfillRequest.update({ where: { id: requestRecord.id }, data: { outcome: "cancelled", statusCode: 200, cancelled, jobId: existing?.id } });
      if (cancelled) await invalidateMarketplaceAnalytics(body.platform);
      return NextResponse.json({ cancelled, audit: marketplaceOperationalEvent("backfill_cancelled", "success") }, { headers: { "x-request-id": requestId } });
    }
    if (body.action === "retry") {
      if (!existing || !["failed", "cancelled"].includes(existing.status)) {
        const message = "Only a failed or cancelled orders backfill can be retried";
        await prisma.marketplaceAnalyticsBackfillRequest.update({ where: { id: requestRecord.id }, data: { outcome: "rejected", statusCode: 409, errorCode: "INVALID_BACKFILL_STATE", errorMessage: message, jobId: existing?.id } });
        return error(requestId, "INVALID_BACKFILL_STATE", message, 409);
      }
      const job = await prisma.marketplaceAnalyticsBackfill.update({ where: { id: existing.id }, data: { status: "pending", retryCount: 0, nextAttemptAt: null, terminalReason: null, error: null, ...window } });
      await prisma.marketplaceAnalyticsBackfillRequest.update({ where: { id: requestRecord.id }, data: { outcome: "accepted", statusCode: 202, jobId: job.id } });
      await invalidateMarketplaceAnalytics(body.platform);
      return NextResponse.json({ job, audit: marketplaceOperationalEvent("backfill_requested", "success") }, { status: 202, headers: { "x-request-id": requestId } });
    }
    const job = await requestOrderBackfill(session, body.platform, body.shopId, window.windowStart, window.windowEnd);
    await prisma.marketplaceAnalyticsBackfillRequest.update({ where: { id: requestRecord.id }, data: { outcome: "accepted", statusCode: 202, jobId: job.id } });
    await invalidateMarketplaceAnalytics(body.platform);
    return NextResponse.json({ job, audit: marketplaceOperationalEvent("backfill_requested", "success") }, { status: 202, headers: { "x-request-id": requestId } });
  } catch (caught) {
    return error(requestId, "INVALID_BODY", caught instanceof Error ? caught.message : "Invalid request", 422);
  }
}
