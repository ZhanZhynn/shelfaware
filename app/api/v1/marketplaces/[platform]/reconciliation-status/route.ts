import { NextRequest } from "next/server";
import { financeMarketplaceGet } from "@/lib/marketplace/v1/finance-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  return financeMarketplaceGet("reconciliation-status", request, context);
}
