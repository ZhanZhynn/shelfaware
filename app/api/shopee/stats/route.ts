import { NextRequest } from "next/server";
import { marketplaceStaticStatsResponse } from "@/lib/marketplace/analytics/http";
export const GET = (request: NextRequest) => marketplaceStaticStatsResponse(request, "shopee");
