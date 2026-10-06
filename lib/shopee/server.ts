/**
 * Shopee Server-Side Client
 * Per-shop SDK instances with configuration guards.
 * Uses @congminh1254/shopee-sdk for HMAC signing, OAuth, and API access.
 *
 * Every authenticated SDK instance owns an immutable shop context. This keeps
 * concurrent requests from reading or refreshing another shop's token.
 */

import { ShopeeSDK } from "@congminh1254/shopee-sdk";
import type { ShopeeRegion } from "@congminh1254/shopee-sdk/schemas";
import { getEnvVar } from "@/lib/env";
import { PrismaTokenStorage } from "./token-storage";

type ShopeeAccessToken = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id: string;
  error: string;
  message: string;
  shop_id?: number;
  merchant_id?: number;
  expired_at?: number;
};

class TransientTokenStorage {
  private token: ShopeeAccessToken | null;

  constructor(
    private readonly shopId: number,
    token: ShopeeAccessToken,
  ) {
    this.token = { ...token, shop_id: shopId };
  }

  async store(token: ShopeeAccessToken): Promise<void> {
    this.token = { ...token, shop_id: this.shopId };
  }

  async get(): Promise<ShopeeAccessToken | null> {
    return this.token;
  }

  async clear(): Promise<void> {
    this.token = null;
  }
}

const shopSdkCache = new Map<number, ShopeeSDK>();
let publicSdk: ShopeeSDK | null = null;

function getShopeeConfig(shopId?: number) {
  const partnerId = getEnvVar("SHOPEE_PARTNER_ID");
  const partnerKey = getEnvVar("SHOPEE_PARTNER_KEY");

  if (!partnerId || !partnerKey) {
    throw new Error(
      "Shopee is not configured. Set SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY.",
    );
  }

  return {
    partner_id: Number(partnerId),
    partner_key: partnerKey,
    region: "GLOBAL" as ShopeeRegion,
    ...(shopId === undefined ? {} : { shop_id: shopId }),
  };
}

/**
 * Get the public SDK used by the OAuth flow. It has no token storage because
 * authorization URL generation and code exchange do not require a shop token.
 */
export function getPublicShopeeSDK(): ShopeeSDK {
  if (!publicSdk) {
    publicSdk = new ShopeeSDK(getShopeeConfig());
  }
  return publicSdk;
}

/**
 * Get the cached SDK for one authenticated shop. Its Prisma token storage is
 * bound to that shop, so token resolution cannot bleed across requests.
 */
export function getShopeeSDK(shopId: number): ShopeeSDK {
  let sdk = shopSdkCache.get(shopId);
  if (!sdk) {
    sdk = new ShopeeSDK(
      getShopeeConfig(shopId),
      new PrismaTokenStorage(shopId),
    );
    shopSdkCache.set(shopId, sdk);
  }
  return sdk;
}

/**
 * Create a short-lived SDK for the OAuth callback before its token has been
 * persisted to a ShopeeShop record. Do not cache this instance.
 */
export function getTransientShopeeSDK(
  shopId: number,
  token: ShopeeAccessToken,
): ShopeeSDK {
  return new ShopeeSDK(
    getShopeeConfig(shopId),
    new TransientTokenStorage(shopId, token),
  );
}

/**
 * Check if Shopee is configured (non-throwing guard for API routes)
 */
export function isShopeeConfigured(): boolean {
  return !!(getEnvVar("SHOPEE_PARTNER_ID") && getEnvVar("SHOPEE_PARTNER_KEY"));
}

/**
 * Shopee API base URLs
 */
export const SHOPEE_URLS = {
  auth: "https://open.shopee.com/auth",
  authSandbox: "https://open.sandbox.test-stable.shopee.com/auth",
  apiBase: "https://partner.shopeemobile.com/api/v2",
} as const;
