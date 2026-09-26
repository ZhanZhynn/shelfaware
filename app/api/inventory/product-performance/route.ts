import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getAdminDataScope } from "@/lib/admin/data-scope";
import { getProductPerformance } from "@/lib/server/product-performance-data";
import type { ProductPerformanceView } from "@/lib/server/product-performance-data";
import { cacheKeys, getCache, setCache } from "@/lib/cache/cache-utils";
import { parseRangeEnd, parseRangeStart } from "@/lib/product-performance/date-range";
import type { DemandPerformance } from "@/types/product-performance";

const TIERS = new Set(["A", "B", "C"]);
const DEMAND_PERFORMANCES = new Set(["growing", "stable", "declining", "no-demand", "insufficient-data"]);

function queryFilter(params: URLSearchParams, key: string, allowed?: Set<string>) {
  const value = params.get(key)?.trim().slice(0, 100) ?? "";
  return !value || !allowed || allowed.has(value) ? value : "";
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const limited = await withRateLimit(request, defaultRateLimits.standard); if (limited) return limited;
  const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dateFrom = params.get("dateFrom"); const dateTo = params.get("dateTo");
  const requestedView = params.get("view");
  const view = ["action", "inactive", "critical", "reorder", "watch", "healthy", "excess", "dormant", "not-stocked", "data-issue", "overstock", "all"].includes(requestedView ?? "") ? requestedView as ProductPerformanceView : "action";
  const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get("pageSize") ?? "50", 10) || 50));
  const tier = queryFilter(params, "tier", TIERS);
  const demandPerformance = queryFilter(params, "performance", DEMAND_PERFORMANCES);
  const channel = queryFilter(params, "channel").toLowerCase();
  const category = queryFilter(params, "category");
  const search = queryFilter(params, "search");
  const parsedFrom = parseRangeStart(dateFrom); const parsedTo = parseRangeEnd(dateTo);
  if ((dateFrom && !parsedFrom) || (dateTo && !parsedTo)) return NextResponse.json({ error: "Use dates in YYYY-MM-DD format." }, { status: 400 });
  const now = new Date(); const toDefault = new Date(now); toDefault.setUTCHours(23, 59, 59, 999);
  const defaultFrom = new Date(toDefault); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29); defaultFrom.setUTCHours(0, 0, 0, 0);
  const from = parsedFrom ?? defaultFrom; const to = parsedTo ?? toDefault;
  if (from > to || to > toDefault || to.getTime() - from.getTime() > 366 * 86_400_000) return NextResponse.json({ error: "Use a valid historical range up to 366 days." }, { status: 400 });
  const scope = await getAdminDataScope(session); const key = cacheKeys.productPerformance.report(scope.cacheScope, `v4:${from.toISOString()}:${to.toISOString()}:${view}:${page}:${pageSize}:${tier}:${demandPerformance}:${channel}:${category}:${search}`);
  const cached = await getCache(key);
  if (cached) return response(cached, startedAt, "hit");
  const data = await getProductPerformance(session.id, from, to, scope, { view, page, pageSize, tier: tier as "A" | "B" | "C" | undefined, demandPerformance: demandPerformance as DemandPerformance | undefined, channel: channel || undefined, category: category || undefined, search: search || undefined });
  await setCache(key, data, 300);
  return response(data, startedAt, "miss");
}

function response(data: unknown, startedAt: number, cache: "hit" | "miss") {
  const duration = performance.now() - startedAt;
  const response = NextResponse.json(data);
  // Lets DevTools distinguish API/database time from Next.js route navigation.
  response.headers.set("Server-Timing", `product-performance;dur=${duration.toFixed(1)}`);
  response.headers.set("X-Product-Performance-Cache", cache);
  return response;
}
