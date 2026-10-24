import { NextRequest } from "next/server";
import { reviewsMarketplaceGet } from "@/lib/marketplace/v1/reviews-route";

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  return reviewsMarketplaceGet(request, (await params).platform, "list");
}
