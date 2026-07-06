import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { getShopeeAdsForUser } from "@/lib/server/shopee-ads-data";
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

    const cacheKey = `shopee:ads:${session.id}:${dateFrom || "30d"}:${dateTo || "now"}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const data = await getShopeeAdsForUser(session.id, dateFrom, dateTo);
    await setCache(cacheKey, data, 300);

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error fetching Shopee ads data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Shopee ads data" },
      { status: 500 },
    );
  }
}
