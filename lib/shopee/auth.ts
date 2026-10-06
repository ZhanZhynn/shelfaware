/**
 * Shopee OAuth Helpers
 * Handles OAuth URL generation and authorization code exchange.
 */

import { getPublicShopeeSDK, getTransientShopeeSDK, isShopeeConfigured } from "./server";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Generate the Shopee authorization URL for OAuth flow.
 * Redirect the user to this URL to authorize the app.
 */
export function getShopeeAuthUrl(): string | null {
  if (!isShopeeConfigured()) return null;

  const sdk = getPublicShopeeSDK();
  const redirectUri = getEnvVar("SHOPEE_REDIRECT_URL");

  if (!redirectUri) {
    logger.error("[Shopee Auth] SHOPEE_REDIRECT_URL is not configured");
    return null;
  }

  return sdk.getAuthorizationUrl(redirectUri);
}

/**
 * Exchange an authorization code for access tokens.
 * Called from the OAuth callback route after the user authorizes.
 *
 * @param code - The authorization code from the callback
 * @param shopId - The shop ID from the callback
 * @returns The access token data, or null on failure
 */
export async function exchangeCodeForToken(
  code: string,
  shopId: number,
): Promise<{
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id: string;
  error: string;
  message: string;
  expired_at: number;
  shop_id: number;
  merchant_id?: number;
} | null> {
  if (!isShopeeConfigured()) return null;

  try {
    const sdk = getPublicShopeeSDK();

    // SDK getAccessToken(code, shopId) — the SDK handles redirect_uri internally
    const token = await sdk.auth.getAccessToken(code, shopId);

    logger.info(`[Shopee Auth] Token acquired for shop ${shopId}`);

    return token as unknown as {
      access_token: string;
      refresh_token: string;
      expire_in: number;
      request_id: string;
      error: string;
      message: string;
      expired_at: number;
      shop_id: number;
      merchant_id?: number;
    };
  } catch (error) {
    logger.error("[Shopee Auth] Failed to exchange code for token:", error);
    return null;
  }
}

/**
 * Get shop information after successful authorization.
 * Uses the callback token directly because the shop record is not persisted yet.
 */
export async function getShopeeShopInfo(
  shopId: number,
  token: {
    access_token: string;
    refresh_token: string;
    expire_in: number;
    request_id: string;
    error: string;
    message: string;
    expired_at: number;
    shop_id: number;
    merchant_id?: number;
  },
): Promise<{
  shop_name: string;
  region: string;
  status: string;
  merchant_id?: number;
  is_cb?: boolean;
  expire_time?: number;
} | null> {
  if (!isShopeeConfigured()) return null;

  try {
    const sdk = getTransientShopeeSDK(shopId, token);
    const info = await sdk.shop.getShopInfo();
    return info as unknown as {
      shop_name: string;
      region: string;
      status: string;
      merchant_id?: number;
      is_cb?: boolean;
      expire_time?: number;
    };
  } catch (error) {
    logger.error("[Shopee Auth] Failed to get shop info:", error);
    return null;
  }
}
