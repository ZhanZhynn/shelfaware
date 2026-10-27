import { marketplaceAuthRoute } from "@/lib/auth/marketplace-auth-route";
import { isLazadaConfigured, getLazadaAuthUrl } from "@/lib/lazada";
import { marketplaceCallbackUri } from "@/lib/auth/marketplace-oauth";

export const GET = marketplaceAuthRoute({ platform: "lazada", configured: isLazadaConfigured, authorizationUrl: (state) => getLazadaAuthUrl(marketplaceCallbackUri("lazada").href, state) });
export const POST = GET;
