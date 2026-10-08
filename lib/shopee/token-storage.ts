/**
 * Shopee Token Storage — Prisma/MongoDB-backed implementation
 * Implements the TokenStorage interface from @congminh1254/shopee-sdk
 * for persistence across serverless cold starts.
 *
 * Each storage instance is bound to one Shopee shop ID.
 */

import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";

/** Matches the SDK's AccessToken interface */
interface AccessToken {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id: string;
  error: string;
  message: string;
  shop_id?: number;
  merchant_id?: number;
  expired_at?: number;
}

/** Matches the SDK's TokenStorage interface */
interface TokenStorage {
  store(token: AccessToken): Promise<void>;
  get(): Promise<AccessToken | null>;
  clear(): Promise<void>;
}

/** Build AccessToken from a ShopeeShop record */
function toAccessToken(shop: {
  shopId: number;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
}): AccessToken {
  const expiredAt = shop.tokenExpiry?.getTime();
  return {
    access_token: shop.accessToken,
    refresh_token: shop.refreshToken,
    expire_in: expiredAt
      ? Math.max(0, Math.floor((expiredAt - Date.now()) / 1000))
      : 14400,
    request_id: "",
    error: "",
    message: "",
    expired_at: expiredAt ?? undefined,
    shop_id: shop.shopId,
  };
}

/**
 * Custom TokenStorage that persists Shopee tokens in MongoDB via Prisma.
 * Tokens are stored per-shop on the ShopeeShop model.
 */
export class PrismaTokenStorage implements TokenStorage {
  constructor(private readonly shopId: number) {}

  /**
   * Store or update a token for a shop.
   * The storage's shop context, rather than mutable request-global state,
   * determines the record to update.
   * Uses upsert to prevent race conditions on concurrent refreshes.
   */
  async store(token: AccessToken): Promise<void> {
    try {
      if (token.shop_id != null && token.shop_id !== this.shopId) {
        logger.warn(
          `[Shopee TokenStorage] Refusing token for shop_id=${token.shop_id} in storage bound to shop_id=${this.shopId}.`,
        );
        return;
      }

      // Find existing shop record by shopId (Shopee's numeric ID)
      const existing = await prisma.shopeeShop.findFirst({
        where: { shopId: this.shopId },
        select: { id: true },
      });

      if (existing) {
        await prisma.shopeeShop.update({
          where: { id: existing.id },
          data: {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            tokenExpiry: token.expired_at
              ? new Date(token.expired_at)
              : null,
            updatedAt: new Date(),
          },
        });
      } else {
        logger.warn(
          `[Shopee TokenStorage] No ShopeeShop record found for shop_id=${this.shopId}. Token not persisted.`,
        );
      }
    } catch (error) {
      logger.error("[Shopee TokenStorage] Failed to store token:", error);
      throw error;
    }
  }

  /**
   * Retrieve the stored token for this storage's shop.
   * The SDK calls this before every authenticated request.
   */
  async get(): Promise<AccessToken | null> {
    try {
      const shop = await prisma.shopeeShop.findFirst({
        where: { shopId: this.shopId },
        select: {
          shopId: true,
          accessToken: true,
          refreshToken: true,
          tokenExpiry: true,
        },
      });

      if (!shop) return null;

      return toAccessToken(shop);
    } catch (error) {
      logger.error("[Shopee TokenStorage] Failed to get token:", error);
      return null;
    }
  }

  /**
   * Clear stored token (used on disconnect).
   */
  async clear(): Promise<void> {
    try {
      const shop = await prisma.shopeeShop.findFirst({
        where: { shopId: this.shopId },
        select: { id: true },
      });

      if (shop) {
        await prisma.shopeeShop.update({
          where: { id: shop.id },
          data: {
            accessToken: "",
            refreshToken: "",
            tokenExpiry: null,
            updatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      logger.error("[Shopee TokenStorage] Failed to clear token:", error);
    }
  }
}
