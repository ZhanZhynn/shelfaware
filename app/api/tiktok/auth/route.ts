import { marketplaceAuthRoute } from "@/lib/auth/marketplace-auth-route";
import { isTikTokConfigured, getTikTokAuthUrl } from "@/lib/tiktok";
import { marketplaceCallbackUri } from "@/lib/auth/marketplace-oauth";

export const GET = marketplaceAuthRoute({ platform: "tiktok", configured: isTikTokConfigured, authorizationUrl: (state) => getTikTokAuthUrl(marketplaceCallbackUri("tiktok").href, state) });
export const POST = GET;
