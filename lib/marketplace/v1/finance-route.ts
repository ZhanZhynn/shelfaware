import { NextRequest, NextResponse } from "next/server";
import { ApiScopeError, requireApiActor } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import {
  assertMarketplaceFinanceShop,
  getMarketplaceFinanceResult,
  MarketplaceFinanceNotFoundError,
  MarketplaceFinanceValidationError,
  parseMarketplaceFinanceQuery,
  type FinanceResource,
} from "./finance";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { normalizedFinanceFilters, type FinanceFilters } from "@/lib/marketplace/finance-filter";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);

function failure(requestId: string, code: string, message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, requestId, ...(details ? { details } : {}) } },
    { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

function responseFilters(resource: FinanceResource, query: Record<string, unknown>) {
  if (resource === "profit") return { shopId: query.shopId ?? null, dateFrom: query.dateFrom ?? null, dateTo: query.dateTo ?? null };
  const filters = query as FinanceFilters & { shopId: string };
  return { shopId: filters.shopId, ...normalizedFinanceFilters(filters) };
}

function responseWarnings(resource: FinanceResource, result: unknown): string[] {
  if (resource === "financial-records") return ((result as { coverage?: { warnings?: string[] } }).coverage?.warnings ?? []);
  if (resource === "reconciliation-status") return ((result as { warnings?: string[] }).warnings ?? []);
  const profit = result as { coverage?: { state?: string; missingCostCategories?: string[] }; refundEvidence?: { warning?: string } };
  return [
    ...(profit.coverage?.state !== "ready" ? ["Financial coverage is incomplete or provisional; this report is not a verified settlement or net-profit statement."] : []),
    ...(profit.coverage?.missingCostCategories?.length ? [`Missing cost categories: ${profit.coverage.missingCostCategories.join(", ")}.`] : []),
    ...(profit.refundEvidence?.warning ? [profit.refundEvidence.warning] : []),
  ];
}

export async function financeMarketplaceGet(resource: FinanceResource, request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { platform } = await params;
  if (!platforms.has(platform as MarketplacePlatform)) return failure(requestId, "NOT_FOUND", "Not found", 404);

  let actor;
  try {
    actor = await requireApiActor(request, ["marketplace:finance"]);
  } catch (error) {
    if (error instanceof ApiScopeError) return failure(requestId, "TOKEN_SCOPE_REQUIRED", "This endpoint requires marketplace finance access", 403, { requiredScopes: ["marketplace:finance"], guidance: "Create or use an API token that includes marketplace:finance." });
    if (error instanceof ApiTokenAuthenticationError) return failure(requestId, "UNAUTHORIZED", "Unauthorized", 401);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
  const limited = await withRateLimit(request, defaultRateLimits.standard, actor.authType === "api_token" ? `api-token:${actor.tokenId}` : actor.user.id);
  if (limited) {
    const headers = new Headers(limited.headers);
    headers.set("x-request-id", requestId);
    headers.set("cache-control", "no-store");
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests", requestId } }, { status: limited.status, headers });
  }

  try {
    const query = parseMarketplaceFinanceQuery(new URL(request.url).searchParams, resource);
    if ("shopId" in query && query.shopId) await assertMarketplaceFinanceShop(platform as MarketplacePlatform, actor.user, query.shopId);
    const result = await getMarketplaceFinanceResult(platform as MarketplacePlatform, actor.user, resource, query);
    const payload = resource === "financial-records" ? result : { data: result };
    return NextResponse.json(
      { apiVersion: "2026-marketplace-v1", ...payload, filters: responseFilters(resource, query as Record<string, unknown>), warnings: responseWarnings(resource, result), meta: { requestId, platform, source: "local" } },
      { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MarketplaceFinanceValidationError) return failure(requestId, "INVALID_QUERY", error.message, 422);
    if (error instanceof MarketplaceFinanceNotFoundError) return failure(requestId, "NOT_FOUND", "Shop not found", 404);
    return failure(requestId, "INTERNAL_ERROR", "Marketplace request failed", 500);
  }
}
