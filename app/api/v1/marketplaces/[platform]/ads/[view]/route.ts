import { NextRequest } from "next/server";
import { adsMarketplaceGet } from "@/lib/marketplace/v1/ads-route";

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string; view: string }> }) {
  return adsMarketplaceGet(request, params);
}
