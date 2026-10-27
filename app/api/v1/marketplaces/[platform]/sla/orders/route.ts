import { NextRequest } from "next/server";
import { slaMarketplaceGet } from "@/lib/marketplace/v1/sla-route";

export const maxDuration = 60;
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  return slaMarketplaceGet(request, (await params).platform, "orders");
}
