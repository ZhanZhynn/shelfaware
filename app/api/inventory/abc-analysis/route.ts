import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { cacheKeys, getCache, setCache } from "@/lib/cache/cache-utils";
import { getAbcAnalysisForUser } from "@/lib/server/abc-analysis-data";
import { getAdminDataScope } from "@/lib/admin/data-scope";
import { logger } from "@/lib/logger";

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
    const channel = searchParams.get("channel") || undefined;

    const dataScope = await getAdminDataScope(session);
    const cacheKey = cacheKeys.abcAnalysis.report(
      dataScope.cacheScope,
      `${dateFrom || "all"}:${dateTo || "all"}:${channel || "all"}`,
    );
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const data = await getAbcAnalysisForUser(
      session.id,
      dateFrom,
      dateTo,
      channel,
      dataScope,
    );

    await setCache(cacheKey, data, 300);

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error fetching ABC analysis:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch ABC analysis" },
      { status: 500 },
    );
  }
}
