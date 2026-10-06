import { NextRequest } from "next/server";
import { liveMarketplaceGet } from "@/lib/marketplace/v1/live-route";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  return liveMarketplaceGet("orders", request, context);
}
