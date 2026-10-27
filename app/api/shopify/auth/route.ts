import { marketplaceAuthRoute } from "@/lib/auth/marketplace-auth-route";
import { isShopifyConfigured, getShopifyAuthUrl } from "@/lib/shopify";

export const GET = marketplaceAuthRoute({ platform: "shopify", configured: isShopifyConfigured, authorizationUrl: (state, shop) => getShopifyAuthUrl(shop!, state) });
export const POST = GET;
