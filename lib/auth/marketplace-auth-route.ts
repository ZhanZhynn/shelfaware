import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { guardBrowserWrite } from "@/lib/security/browser-request";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";
import { assertShopOperator, beginMarketplaceOAuth, marketplaceConnectUrl, MarketplaceOAuthError } from "./marketplace-oauth";
import { validShopifyDomain, type OAuthPlatform } from "./marketplace-connect";

type Options = { platform: OAuthPlatform; configured: () => boolean; authorizationUrl: (state: string, shop?: string) => string | null };

export function marketplaceAuthRoute(options: Options) {
  return async (request: NextRequest) => {
    try {
      const post = request.method === "POST";
      if (post) { const blocked = guardBrowserWrite(request, true); if (blocked) return blocked; }
      const user = await getSessionFromRequest(request);
      assertShopOperator(user);
      if (!options.configured()) throw new MarketplaceOAuthError("Marketplace integration is not configured", 503);
      const input = post ? await request.json() : Object.fromEntries(new URL(request.url).searchParams);
      const shop = options.platform === "shopify" ? input?.shop : undefined;
      if (shop !== undefined && (typeof shop !== "string" || !validShopifyDomain(shop))) throw new MarketplaceOAuthError("Invalid Shopify store domain");
      if (!post) return NextResponse.json({ url: marketplaceConnectUrl(options.platform, shop).href }, { headers: { "cache-control": "no-store" } });
      if (options.platform === "shopify" && !shop) throw new MarketplaceOAuthError("Shopify store domain is required");
      const limited = await withRateLimit(request, { ...defaultRateLimits.strict, limit: 10, window: 600 }, `marketplace-connect:${user.id}`);
      if (limited) return limited;
      const attempt = await beginMarketplaceOAuth(request, user, options.platform, shop);
      const url = options.authorizationUrl(attempt.state, shop);
      if (!url) throw new MarketplaceOAuthError("Could not create authorization URL", 503);
      return attempt.setCookie(NextResponse.json({ url }));
    } catch (error) {
      if (error instanceof MarketplaceOAuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: { "cache-control": "no-store" } });
      logger.error("Marketplace authorization failed", error);
      return NextResponse.json({ error: "Marketplace authorization failed" }, { status: 500 });
    }
  };
}
