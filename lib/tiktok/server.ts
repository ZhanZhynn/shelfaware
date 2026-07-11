/**
 * TikTok Shop Server-Side Module
 * Handles OAuth flow, token management, active shop context.
 *
 * Pattern: Same as Lazada's server.ts — module-level activeShopId,
 * lazy token refresh, Prisma persistence.
 *
 * Key differences from Lazada:
 * - Token exchange: GET to auth.tiktok-shops.com (not POST to API)
 * - grant_type: "authorized_code" (not "authorization_code")
 * - Access token: 7-day window (not 10-day)
 * - Shop cipher: Required for all shop-level API calls
 */

import prisma from "@/prisma/client";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getAuthorizedShops } from "./custom-api";
import type { TikTokTokenData } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────

const TIKTOK_AUTH_HOST = "https://auth.tiktok-shops.com";
const TOKEN_GET_PATH = "/api/v2/token/get";
const TOKEN_REFRESH_PATH = "/api/v2/token/refresh";
const GRANT_TYPE = "authorized_code"; // NOT "authorization_code"

// ─── Active Shop Context ──────────────────────────────────────────────────

let activeShopId: string | null = null;

export function setActiveShop(shopId: string): void {
  activeShopId = shopId;
}

export function getActiveShopId(): string | null {
  return activeShopId;
}

// ─── Configuration Guard ──────────────────────────────────────────────────

export function isTikTokConfigured(): boolean {
  return !!(getEnvVar("TIKTOK_APP_KEY") && getEnvVar("TIKTOK_APP_SECRET"));
}

// ─── OAuth URL ────────────────────────────────────────────────────────────

/**
 * Generate the TikTok Shop authorization URL for OAuth flow.
 * Redirects user to TikTok's consent page.
 */
export function getTikTokAuthUrl(redirectUri: string): string | null {
  if (!isTikTokConfigured()) return null;

  const serviceId = getEnvVar("TIKTOK_SERVICE_ID") || "default";

  // US market: services.us.tiktokshop.com, ROW: services.tiktokshop.com
  const authBase = "https://services.tiktokshop.com";
  const url = `${authBase}/open/authorize?service_id=${serviceId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return url;
}

// ─── Token Exchange ───────────────────────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 * TikTok uses GET to auth.tiktok-shops.com (not the API base).
 * grant_type must be "authorized_code" (NOT "authorization_code").
 */
export async function exchangeCodeForToken(
  authCode: string,
): Promise<TikTokTokenData | null> {
  const appKey = getEnvVar("TIKTOK_APP_KEY");
  const appSecret = getEnvVar("TIKTOK_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("TikTok is not configured. Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET.");
  }

  const params = new URLSearchParams({
    grant_type: GRANT_TYPE,
    auth_code: authCode,
    app_key: appKey,
    app_secret: appSecret,
  });

  const url = `${TIKTOK_AUTH_HOST}${TOKEN_GET_PATH}?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 0) {
      logger.error(`[TikTok Auth] Token exchange failed: ${data.message} (code: ${data.code})`);
      return null;
    }

    return data.data as TikTokTokenData;
  } catch (error) {
    logger.error("[TikTok Auth] Token exchange request failed:", error);
    return null;
  }
}

// ─── Token Refresh ────────────────────────────────────────────────────────

/**
 * Refresh an expired access token using a refresh token.
 * Same endpoint host as token exchange, different path.
 */
export async function refreshTikTokToken(
  refreshToken: string,
): Promise<TikTokTokenData | null> {
  const appKey = getEnvVar("TIKTOK_APP_KEY");
  const appSecret = getEnvVar("TIKTOK_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("TikTok is not configured. Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    app_key: appKey,
    app_secret: appSecret,
  });

  const url = `${TIKTOK_AUTH_HOST}${TOKEN_REFRESH_PATH}?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 0) {
      logger.error(`[TikTok Auth] Token refresh failed: ${data.message} (code: ${data.code})`);
      return null;
    }

    return data.data as TikTokTokenData;
  } catch (error) {
    logger.error("[TikTok Auth] Token refresh request failed:", error);
    return null;
  }
}

// ─── Token Persistence ────────────────────────────────────────────────────

/**
 * Persist tokens from a token exchange or refresh response.
 * Updates the TikTokShop record in MongoDB.
 */
export async function persistTokens(
  shopId: string,
  tokenData: TikTokTokenData,
): Promise<void> {
  const now = new Date();
  const accessTokenExpiry = tokenData.access_token_expire_in
    ? new Date(tokenData.access_token_expire_in * 1000) // API returns Unix timestamp, not duration
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Default: 7 days

  const refreshTokenExpiry = tokenData.refresh_token_expire_in
    ? new Date(tokenData.refresh_token_expire_in * 1000)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // Default: 365 days

  await prisma.tikTokShop.update({
    where: { id: shopId },
    data: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: accessTokenExpiry,
      refreshExpiry: refreshTokenExpiry,
      openId: tokenData.open_id || undefined,
      updatedAt: now,
    },
  });

  logger.info(`[TikTok TokenStorage] Tokens persisted for shop ${shopId}`);
}

// ─── Token Validation ─────────────────────────────────────────────────────

/**
 * Validate that the current token can successfully call the TikTok API.
 * Makes a lightweight API call to check token validity.
 */
export async function validateTikTokToken(): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    const shop = await getActiveShopRecord();
    if (!shop?.accessToken) {
      return { valid: false, error: "No access token available" };
    }

    // Use getAuthorizedShops as a lightweight auth check
    await getAuthorizedShops(shop.accessToken);
    return { valid: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[TikTok] Token validation failed: ${msg}`);
    return { valid: false, error: msg };
  }
}

// ─── Ensure Fresh Token ───────────────────────────────────────────────────

/**
 * Get the active shop's record from DB.
 * Uses activeShopId if set, otherwise falls back to most recently updated shop.
 */
async function getActiveShopRecord() {
  if (activeShopId) {
    return prisma.tikTokShop.findFirst({
      where: { shopId: activeShopId },
    });
  }
  return prisma.tikTokShop.findFirst({
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Ensure the active shop has a valid token, refreshing if needed.
 * Called internally before any authenticated API operation.
 */
export async function ensureFreshToken(): Promise<string> {
  const shop = await getActiveShopRecord();

  if (!shop?.accessToken) {
    throw new Error("No TikTok shop found or access token missing.");
  }

  // Check if token is expiring within 24 hours
  const needsRefresh =
    !shop.tokenExpiry ||
    shop.tokenExpiry.getTime() - Date.now() < 24 * 60 * 60 * 1000;

  if (needsRefresh) {
    if (!shop.refreshToken) {
      throw new Error("TikTok token expired and no refresh token available. Please re-authorize.");
    }

    logger.info("[TikTok] Refreshing access token...");
    const tokenData = await refreshTikTokToken(shop.refreshToken);

    if (!tokenData?.access_token) {
      throw new Error("TikTok token refresh failed. Please re-authorize the shop.");
    }

    await persistTokens(shop.id, tokenData);
    return tokenData.access_token;
  }

  return shop.accessToken;
}

// ─── Shop Cipher ──────────────────────────────────────────────────────────

/**
 * Get the shop cipher for the active shop.
 * Shop cipher is required for all shop-level API calls.
 */
export async function getActiveShopCipher(): Promise<string> {
  const shop = await getActiveShopRecord();

  if (!shop?.shopCipher) {
    throw new Error("No TikTok shop found or shop cipher missing.");
  }

  return shop.shopCipher;
}

// ─── Auth URLs ────────────────────────────────────────────────────────────

export const TIKTOK_URLS = {
  auth: "https://services.tiktokshop.com/open/authorize",
  authUS: "https://services.us.tiktokshop.com/open/authorize",
  tokenGet: "https://auth.tiktok-shops.com/api/v2/token/get",
  tokenRefresh: "https://auth.tiktok-shops.com/api/v2/token/refresh",
  apiBase: "https://open-api.tiktokglobalshop.com",
} as const;
