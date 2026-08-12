import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { canViewSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled, isSharedSkuMappingAnalyticsEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { getCrossChannelPerformance } from "@/lib/marketplace-attribution/analytics";
import { parseRangeEnd, parseRangeStart } from "@/lib/product-performance/date-range";

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled()) return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  if (!isSharedSkuMappingAnalyticsEnabled()) return NextResponse.json({ error: "Shared SKU mapping analytics are not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewSharedAttribution(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = new URL(request.url).searchParams; const from = parseRangeStart(params.get("dateFrom")); const to = parseRangeEnd(params.get("dateTo"));
  if (!from || !to || from > to || to.getTime() - from.getTime() > 366 * 86_400_000) return NextResponse.json({ error: "Use a valid YYYY-MM-DD range up to 366 days." }, { status: 400 });
  const reportingCurrency = params.get("reportingCurrency")?.trim().toUpperCase() || undefined;
  return NextResponse.json(await getCrossChannelPerformance(from, to, { reportingCurrency }));
}
