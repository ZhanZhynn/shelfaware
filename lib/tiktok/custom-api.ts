/**
 * TikTok Shop Custom API Client
 * Fetch-based HTTP client for TikTok Shop Open API.
 * Same pattern as Lazada's custom-api.ts — no SDK dependency.
 *
 * Signing: HMAC-SHA256 via lib/tiktok/signing.ts
 * Auth: x-tts-access-token header + app_key/timestamp/sign query params
 */

import { generateSign } from "./signing";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  TikTokBaseResponse,
  TikTokSearchProductsData,
  TikTokGetProductDetailData,
  TikTokSearchOrdersData,
  TikTokGetOrderDetailData,
  TikTokShopInfo,
} from "./types";

const TTS_API_BASE = "https://open-api.tiktokglobalshop.com";

// ─── Core Request Helper ──────────────────────────────────────────────────

interface TikTokRequestOptions {
  method: "GET" | "POST";
  path: string;
  accessToken: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

/**
 * Make a signed request to the TikTok Shop Open API.
 * Handles: timestamp, app_key, signing, access token header, response parsing.
 */
async function tiktokRequest<T>(
  options: TikTokRequestOptions,
): Promise<TikTokBaseResponse<T>> {
  const { method, path, accessToken, params = {}, body } = options;

  const appKey = getEnvVar("TIKTOK_APP_KEY");
  const appSecret = getEnvVar("TIKTOK_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("TikTok Shop is not configured. Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET.");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));

  // Build query params with required fields
  const queryParams: Record<string, string> = {
    app_key: appKey,
    timestamp,
    ...params,
  };

  // Generate signature
  const bodyString = body ? JSON.stringify(body) : null;
  const sign = generateSign(path, queryParams, bodyString, appSecret);
  queryParams.sign = sign;

  // Build URL
  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${TTS_API_BASE}${path}?${queryString}`;

  // Make request
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-tts-access-token": accessToken,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: bodyString,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error(`[TikTok API] HTTP ${response.status}: ${text}`);
    throw new Error(`TikTok API HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as TikTokBaseResponse<T>;

  if (data.code !== 0) {
    logger.error(`[TikTok API] Error ${data.code}: ${data.message} (request_id: ${data.request_id})`);
    throw new Error(`TikTok API error ${data.code}: ${data.message}`);
  }

  // Debug: log response structure (first item only for large responses)
  if (data.code === 0 && data.data && typeof data.data === "object") {
    const keys = Object.keys(data.data);
    const sample: Record<string, unknown> = {};
    for (const key of keys) {
      const val = (data.data as any)[key];
      if (Array.isArray(val)) {
        sample[key] = `[Array(${val.length})]${val.length > 0 ? " first_keys=" + JSON.stringify(Object.keys(val[0] || {})) : ""}`;
      } else {
        sample[key] = typeof val === "object" && val !== null ? Object.keys(val) : val;
      }
    }
    logger.info(`[TikTok API] ${method} ${path} → ${JSON.stringify(sample)}`);
  }

  return data;
}

// ─── Authorization ────────────────────────────────────────────────────────

/**
 * Get authorized shops for the current app.
 * Requires a valid access token (from token exchange).
 * Returns shops with their cipher (required for shop-level API calls).
 */
export async function getAuthorizedShops(
  accessToken: string,
): Promise<TikTokShopInfo[]> {
  const resp = await tiktokRequest<{ shops: TikTokShopInfo[] }>({
    method: "GET",
    path: "/authorization/202309/shops",
    accessToken,
  });
  return resp.data?.shops ?? [];
}

// ─── Products ─────────────────────────────────────────────────────────────

interface SearchProductsBody {
  status?: string;
  seller_skus?: string[];
  create_time_ge?: number;
  create_time_le?: number;
  update_time_ge?: number;
  update_time_le?: number;
  [key: string]: unknown;
}

/**
 * Search/list products for a shop.
 * Uses token-based pagination (next_page_token).
 */
export async function searchProducts(
  accessToken: string,
  shopCipher: string,
  body: SearchProductsBody = {},
  pageSize: number = 50,
  pageToken?: string,
): Promise<TikTokSearchProductsData> {
  const params: Record<string, string> = {
    page_size: String(pageSize),
    shop_cipher: shopCipher,
  };
  if (pageToken) {
    params.page_token = pageToken;
  }

  const resp = await tiktokRequest<TikTokSearchProductsData>({
    method: "POST",
    path: "/product/202502/products/search",
    accessToken,
    params,
    body,
  });

  return resp.data ?? { products: [], total: 0, more: false, next_page_token: "" };
}

/**
 * Get product detail by product ID.
 */
export async function getProductDetail(
  accessToken: string,
  shopCipher: string,
  productId: string,
): Promise<TikTokGetProductDetailData> {
  const resp = await tiktokRequest<TikTokGetProductDetailData>({
    method: "GET",
    path: `/product/202309/products/${productId}`,
    accessToken,
    params: { shop_cipher: shopCipher },
  });

  return resp.data ?? { product: {} as any };
}

// ─── Orders ───────────────────────────────────────────────────────────────

interface SearchOrdersBody {
  order_status?: string;
  create_time_ge?: number;
  create_time_lt?: number;
  update_time_ge?: number;
  update_time_lt?: number;
  [key: string]: unknown;
}

/**
 * Search/list orders for a shop.
 * Uses token-based pagination (next_page_token).
 */
export async function searchOrders(
  accessToken: string,
  shopCipher: string,
  body: SearchOrdersBody = {},
  pageSize: number = 50,
  pageToken?: string,
  sortField?: string,
  sortOrder?: "ASC" | "DESC",
): Promise<TikTokSearchOrdersData> {
  const params: Record<string, string> = {
    page_size: String(pageSize),
    shop_cipher: shopCipher,
  };
  if (pageToken) {
    params.page_token = pageToken;
  }
  if (sortField) {
    params.sort_field = sortField;
  }
  if (sortOrder) {
    params.sort_order = sortOrder;
  }

  const resp = await tiktokRequest<TikTokSearchOrdersData>({
    method: "POST",
    path: "/order/202309/orders/search",
    accessToken,
    params,
    body,
  });

  return resp.data ?? { orders: [], total_count: 0, next_page_token: "" };
}

/**
 * Get order details by IDs (batch up to 50).
 */
export async function getOrderDetail(
  accessToken: string,
  shopCipher: string,
  orderIds: string[],
): Promise<TikTokGetOrderDetailData> {
  if (orderIds.length === 0) return { orders: [] };
  if (orderIds.length > 50) {
    throw new Error("TikTok getOrderDetail supports max 50 order IDs per request");
  }

  const resp = await tiktokRequest<TikTokGetOrderDetailData>({
    method: "GET",
    path: "/order/202309/orders",
    accessToken,
    params: {
      ids: orderIds.join(","),
      shop_cipher: shopCipher,
    },
  });

  return resp.data ?? { orders: [] };
}
