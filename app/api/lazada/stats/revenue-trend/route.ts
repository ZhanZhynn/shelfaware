import { NextRequest } from "next/server";
import { marketplaceStaticMetricResponse } from "@/lib/marketplace/analytics/http";
export const GET = (request: NextRequest) => marketplaceStaticMetricResponse(request, "lazada", "revenue-trend");
