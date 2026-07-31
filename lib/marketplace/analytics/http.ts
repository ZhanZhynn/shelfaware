import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { ANALYTICS_CALCULATION_VERSION, AnalyticsValidationError, getMarketplaceAnalytics } from "./server";
import { ANALYTICS_API_VERSION } from "./cache";
import { legacyMarketplaceStatsResponse } from "./legacy";
import { legacyMarketplaceMetricResponse } from "./legacy";
import type { MarketplacePlatform } from "./types";

const metrics = new Set(["summary", "revenue-trend", "products", "buyers", "clv", "profit"]);

/** Static stats paths are legacy by default; v1 clients must opt in explicitly. */
export function requestsMarketplaceAnalyticsV1(params: URLSearchParams) {
  return params.get("apiVersion") === ANALYTICS_API_VERSION;
}

export function staticStatsContract(params: URLSearchParams) {
  return requestsMarketplaceAnalyticsV1(params) ? "v1" : "legacy";
}

export async function marketplaceStaticStatsResponse(request: NextRequest, platform: MarketplacePlatform) {
  if (staticStatsContract(new URL(request.url).searchParams) === "v1") return marketplaceStatsResponse(request, platform);
  const response = await legacyMarketplaceStatsResponse(request, platform);
  response.headers.set("Deprecation", "true");
  response.headers.set("x-marketplace-analytics-contract", "legacy");
  return response;
}

/** Static metric paths existed before v1 and therefore retain their legacy contract by default. */
export async function marketplaceStaticMetricResponse(request: NextRequest, platform: MarketplacePlatform, metric: string) {
  if (staticStatsContract(new URL(request.url).searchParams) === "v1") return marketplaceStatsResponse(request, platform, metric);
  const response = await legacyMarketplaceMetricResponse(request, platform, metric);
  response.headers.set("Deprecation", "true");
  response.headers.set("x-marketplace-analytics-contract", "legacy");
  return response;
}

export async function marketplaceStatsResponse(request: NextRequest, platform: MarketplacePlatform, metric = "summary") {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const respondError = (code: string, message: string, status: number, details?: Record<string, string>) => NextResponse.json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers: { "x-request-id": requestId } });
  const limited = await withRateLimit(request, defaultRateLimits.standard);
  if (limited) return limited;
  const session = await getSessionFromRequest(request);
  if (!session) return respondError("UNAUTHORIZED", "Unauthorized", 401);
  if (!metrics.has(metric)) return respondError("NOT_FOUND", "Not found", 404);
  try {
    const result = await getMarketplaceAnalytics(platform, session, new URL(request.url).searchParams, metric);
    const key = metric === "summary" ? "summary" : metric === "revenue-trend" ? "revenueTrend" : metric;
    return NextResponse.json({ apiVersion: "2026-analytics-v1", calculationVersion: ANALYTICS_CALCULATION_VERSION, requestId, platform, metric, filters: result.filters, data: result[key as keyof typeof result], operationalCoverage: result.operationalCoverage, financialCoverage: result.financialCoverage, capabilities: result.capabilities, warnings: result.operationalCoverage.reason ? [result.operationalCoverage.reason] : [], page: result.page }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof AnalyticsValidationError) {
      return respondError(error.code, error.message, error.code === "MIXED_CURRENCY" || error.code === "CONVERSION_UNAVAILABLE" ? 409 : error.code === "FORBIDDEN" ? 403 : 422, { class: "validation" });
    }
    return respondError("INTERNAL_ERROR", "Analytics request failed", 500);
  }
}
