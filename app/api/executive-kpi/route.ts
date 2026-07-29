import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { getExecutiveKpiForUser } from "@/lib/server/executive-kpi-data";
import { logger } from "@/lib/logger";
import { getAdminDataScope } from "@/lib/admin/data-scope";

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const dataScope = await getAdminDataScope(session);
    const cacheScope = dataScope.sharedAdmin ? dataScope.cacheScope : session.id;

    const cacheKey = `executive-kpi:v3:${cacheScope}:${dateFrom || "30d"}:${dateTo || "now"}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const data = await getExecutiveKpiForUser(session.id, dateFrom, dateTo, dataScope);
    await setCache(cacheKey, data, 300);

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error fetching executive KPI data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch executive KPI data" },
      { status: 500 },
    );
  }
}
