import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getAdminDataScope } from "@/lib/admin/data-scope";
import { getProductPerformance } from "@/lib/server/product-performance-data";
import { cacheKeys, getCache, setCache } from "@/lib/cache/cache-utils";
import { parseRangeEnd, parseRangeStart } from "@/lib/product-performance/date-range";

export async function GET(request: NextRequest) {
  const limited = await withRateLimit(request, defaultRateLimits.standard); if (limited) return limited;
  const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const dateFrom = params.get("dateFrom"); const dateTo = params.get("dateTo");
  const parsedFrom = parseRangeStart(dateFrom); const parsedTo = parseRangeEnd(dateTo);
  if ((dateFrom && !parsedFrom) || (dateTo && !parsedTo)) return NextResponse.json({ error: "Use dates in YYYY-MM-DD format." }, { status: 400 });
  const now = new Date(); const toDefault = new Date(now); toDefault.setUTCHours(23, 59, 59, 999);
  const defaultFrom = new Date(toDefault); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29); defaultFrom.setUTCHours(0, 0, 0, 0);
  const from = parsedFrom ?? defaultFrom; const to = parsedTo ?? toDefault;
  if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) return NextResponse.json({ error: "Use a valid range up to 366 days." }, { status: 400 });
  const scope = await getAdminDataScope(session); const key = cacheKeys.productPerformance.report(scope.cacheScope, `${from.toISOString()}:${to.toISOString()}`);
  const cached = await getCache(key); if (cached) return NextResponse.json(cached);
  const data = await getProductPerformance(session.id, from, to, scope); await setCache(key, data, 300);
  return NextResponse.json(data);
}
