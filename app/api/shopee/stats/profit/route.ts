import { marketplaceStaticMetricResponse } from "@/lib/marketplace/analytics/http";
import type { NextRequest } from "next/server";

export const GET = (request: NextRequest) => marketplaceStaticMetricResponse(request, "shopee", "profit");
