export const marketplacePlatforms = ["shopee", "lazada", "tiktok", "shopify"] as const;
export type OAuthPlatform = (typeof marketplacePlatforms)[number];
export const isOAuthPlatform = (value: string): value is OAuthPlatform => (marketplacePlatforms as readonly string[]).includes(value);
export const validShopifyDomain = (value: string) => /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(value);

/** Only this local connection flow may be resumed after login. */
export function safeMarketplaceConnectPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/marketplace/connect/")) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.hash || !/^\/marketplace\/connect\/(shopee|lazada|tiktok|shopify)$/.test(url.pathname)) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "shop") || url.searchParams.getAll("shop").length > 1) return null;
    const shop = url.searchParams.get("shop");
    if (shop && (!url.pathname.endsWith("/shopify") || !validShopifyDomain(shop))) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
