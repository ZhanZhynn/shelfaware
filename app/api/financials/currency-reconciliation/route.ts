import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getUnknownCurrencyReconciliation } from "@/lib/server/financial-currency";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    return NextResponse.json(await getUnknownCurrencyReconciliation(session.id));
  } catch (error) {
    logger.error("Error fetching unknown-currency reconciliation:", error);
    return NextResponse.json({ error: "Failed to fetch currency reconciliation" }, { status: 500 });
  }
}
