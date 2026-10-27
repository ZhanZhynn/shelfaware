import { marketplaceAuthRoute } from "@/lib/auth/marketplace-auth-route";
import { isShopeeConfigured, getShopeeAuthUrl } from "@/lib/shopee";

export const GET = marketplaceAuthRoute({ platform: "shopee", configured: isShopeeConfigured, authorizationUrl: getShopeeAuthUrl });
export const POST = GET;
