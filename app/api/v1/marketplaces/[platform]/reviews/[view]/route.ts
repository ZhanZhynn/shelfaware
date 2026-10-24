import { NextRequest } from "next/server";
import { reviewsMarketplaceGet } from "@/lib/marketplace/v1/reviews-route";

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string; view: string }> }) {
  const { platform, view } = await params;
  return reviewsMarketplaceGet(request, platform, view);
}
