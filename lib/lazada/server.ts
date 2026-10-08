/** Lazada server helpers. Authentication is always bound to an explicit shop. */

import { LazadaModule } from "lazada-api-client";
import type { LazadaConfig, LazadaResponseAccessToken } from "lazada-api-client";
import prisma from "@/prisma/client";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";

const LAZADA_ENDPOINTS: Record<string, string> = {
  vn: "https://api.lazada.vn/rest",
  sg: "https://api.lazada.sg/rest",
  my: "https://api.lazada.com.my/rest",
  th: "https://api.lazada.co.th/rest",
  ph: "https://api.lazada.com.ph/rest",
  id: "https://api.lazada.co.id/rest",
};
const DEFAULT_LAZADA_ENDPOINT = "https://api.lazada.com.my/rest";

export function getLazadaEndpoint(countryCode = "my"): string {
  return LAZADA_ENDPOINTS[countryCode] ?? DEFAULT_LAZADA_ENDPOINT;
}

/**
 * A request-scoped capability for one internally authorised Lazada shop.
 * Never construct this from a seller ID supplied by a caller alone.
 */
export type LazadaShopContext = Readonly<{
  shopId: string;
  userId: string;
  sellerId: string;
  countryCode: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  refreshExpiry: Date | null;
}>;

type LazadaShopRecord = {
  id: string;
  userId: string;
  sellerId: string;
  countryCode: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  refreshExpiry: Date | null;
};

export function createLazadaShopContext(shop: LazadaShopRecord): LazadaShopContext {
  return {
    shopId: shop.id,
    userId: shop.userId,
    sellerId: shop.sellerId,
    countryCode: shop.countryCode,
    accessToken: shop.accessToken,
    refreshToken: shop.refreshToken,
    tokenExpiry: shop.tokenExpiry,
    refreshExpiry: shop.refreshExpiry,
  };
}

function getLazadaCredentials(): { appKey: string; appSecret: string } {
  const appKey = getEnvVar("LAZADA_APP_KEY");
  const appSecret = getEnvVar("LAZADA_APP_SECRET");
  if (!appKey || !appSecret) {
    throw new Error("Lazada is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET.");
  }
  return { appKey, appSecret };
}

function configFor(context: LazadaShopContext): LazadaConfig {
  const { appKey, appSecret } = getLazadaCredentials();
  const config: LazadaConfig = {
    appKey,
    appSecret,
    countryCode: context.countryCode,
    shopId: context.sellerId,
    appAccessToken: context.accessToken,
    refreshToken: context.refreshToken,
  };
  if (context.tokenExpiry) config.expiresIn = Math.max(0, Math.floor((context.tokenExpiry.getTime() - Date.now()) / 1000));
  if (context.refreshExpiry) config.refreshExpiresIn = Math.max(0, Math.floor((context.refreshExpiry.getTime() - Date.now()) / 1000));
  return config;
}

function contextWithTokens(context: LazadaShopContext, token: LazadaResponseAccessToken): LazadaShopContext {
  const now = Date.now();
  return {
    ...context,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiry: token.expires_in ? new Date(now + token.expires_in * 1000) : null,
    refreshExpiry: token.refresh_expires_in ? new Date(now + token.refresh_expires_in * 1000) : null,
  };
}

/** Persist only to the exact internal shop represented by the context. */
export async function persistTokens(context: LazadaShopContext, token: LazadaResponseAccessToken): Promise<LazadaShopContext> {
  const updatedContext = contextWithTokens(context, token);
  const result = await prisma.lazadaShop.updateMany({
    where: { id: context.shopId, userId: context.userId, sellerId: context.sellerId },
    data: {
      accessToken: updatedContext.accessToken,
      refreshToken: updatedContext.refreshToken,
      tokenExpiry: updatedContext.tokenExpiry,
      refreshExpiry: updatedContext.refreshExpiry,
      updatedAt: new Date(),
    },
  });
  if (result.count !== 1) {
    throw new Error(`Lazada shop ${context.shopId} is no longer available for token persistence.`);
  }
  return updatedContext;
}

/**
 * Refresh the selected shop only. The SDK is created per operation: no SDK or
 * configuration is shared between tenants.
 */
export async function ensureFreshLazadaToken(context: LazadaShopContext): Promise<LazadaShopContext> {
  const expiresIn = context.tokenExpiry ? Math.floor((context.tokenExpiry.getTime() - Date.now()) / 1000) : undefined;
  if (context.accessToken && (expiresIn === undefined || expiresIn >= 86400)) return context;
  if (!context.refreshToken) return context;

  try {
    const sdk = new LazadaModule(configFor(context));
    const token = await sdk.refreshToken();
    if (!token?.access_token) throw new Error("Lazada did not return an access token.");
    return await persistTokens(context, token);
  } catch (error) {
    logger.error(`[Lazada] Token refresh failed for shop ${context.shopId}:`, error);
    throw new Error("Lazada token refresh failed. Please re-authorize the seller.");
  }
}

/** Validate one selected shop's token with a signed lightweight API request. */
export async function validateLazadaToken(context: LazadaShopContext): Promise<{ valid: boolean; error?: string }> {
  try {
    const config = configFor(context);
    if (!config.appAccessToken) return { valid: false, error: "No access token available" };
    const path = "/products/get";
    const timestamp = Date.now();
    const params: Record<string, string> = {
      app_key: config.appKey,
      timestamp: String(timestamp),
      sign_method: "sha256",
      access_token: config.appAccessToken,
      limit: "1",
      offset: "0",
    };
    const sortedKeys = Object.keys(params).sort();
    const signString = `${path}${sortedKeys.map((key) => `${key}${params[key]}`).join("")}`;
    const crypto = await import("crypto");
    const sign = crypto.createHmac("sha256", config.appSecret).update(signString).digest("hex").toUpperCase();
    const query = sortedKeys.map((key) => `${key}=${encodeURIComponent(params[key] ?? "")}`).join("&");
    const response = await fetch(`${getLazadaEndpoint(context.countryCode)}${path}?${query}&sign=${sign}`);
    const data = await response.json();
    if (data.code === "0" || data.code === 0) return { valid: true };
    const error = data.msg || data.message || `API error code: ${data.code}`;
    logger.warn(`[Lazada] Token validation failed for shop ${context.shopId}: ${error}`);
    return { valid: false, error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Lazada] Token validation request failed for shop ${context.shopId}: ${message}`);
    return { valid: false, error: message };
  }
}

export function isLazadaConfigured(): boolean {
  return !!(getEnvVar("LAZADA_APP_KEY") && getEnvVar("LAZADA_APP_SECRET"));
}

export const LAZADA_URLS = {
  auth: "https://auth.lazada.com/oauth/authorize",
  tokenCreate: "https://auth.lazada.com/rest/auth/token/create",
  tokenRefresh: "https://auth.lazada.com/rest/auth/token/refresh",
} as const;

export function getLazadaAuthUrl(redirectUri: string): string | null {
  if (!isLazadaConfigured()) return null;
  const { appKey, appSecret } = getLazadaCredentials();
  return new LazadaModule({ appKey, appSecret }).generateAuthLink(redirectUri).url;
}

export async function exchangeLazadaCodeForToken(code: string): Promise<LazadaResponseAccessToken | null> {
  if (!isLazadaConfigured()) return null;
  try {
    const { appKey, appSecret } = getLazadaCredentials();
    return await new LazadaModule({ appKey, appSecret }).fetchTokenWithAuthCode(code);
  } catch (error) {
    logger.error("[Lazada Auth] Failed to exchange code for token:", error);
    return null;
  }
}
