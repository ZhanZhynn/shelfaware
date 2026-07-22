import { NextRequest, NextResponse } from "next/server";
import { refreshExchangeRate } from "@/lib/exchange-rates/service";
import { logger } from "@/lib/logger";
import { invalidateAllServerCaches } from "@/lib/cache";

export const runtime = "nodejs";

async function refresh(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rate = await refreshExchangeRate();
    void invalidateAllServerCaches();
    return NextResponse.json(rate);
  } catch (error) {
    logger.error("[Exchange rates] Refresh failed", error);
    return NextResponse.json({ error: "Unable to refresh exchange rate" }, { status: 502 });
  }
}

export const GET = refresh;
export const POST = refresh;
