/**
 * Custom Lazada API Functions
 * Implements API calls following official documentation.
 * The SDK's getProducts is broken (missing mandatory filter parameter).
 */

import { getLazadaEndpoint } from "./server";
import { getEnvVar } from "@/lib/env";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { createHmac } from "crypto";

/**
 * Convert Unix timestamp (milliseconds) to ISO 8601 format.
 * Lazada API returns updated_time as Unix ms but expects ISO 8601 for date params.
 * Format: 2024-01-15T10:30:00+0800
 */
function unixTimestampToISO8601(unixMs: string): string {
  const date = new Date(Number(unixMs));
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  const iso = date.toISOString().replace(/\.\d{3}Z$/, `${sign}${hours}${minutes}`);
  return iso;
}

interface LazadaProduct {
  item_id: string;
  primary_category: string;
  attributes: {
    name: string;
    description?: string;
    short_description?: string;
    brand?: string;
    [key: string]: unknown;
  };
  skus: Array<{
    SellerSku: string;
    ShopSku: string;
    Status: string;
    price: number | string;
    special_price?: number | string;
    quantity: number;
    Available: number;
    Images: string[];
    SkuId: number;
    [key: string]: unknown;
  }>;
  images: string[];
  status: string;
  created_time: string;
  updated_time: string;
  [key: string]: unknown;
}

interface GetProductsParams {
  filter?: "all" | "live" | "inactive" | "deleted" | "pending" | "rejected" | "sold-out";
  limit?: number;
  offset?: number;
  create_after?: string;
  update_after?: string;
  create_before?: string;
  update_before?: string;
  options?: number;
  sku_seller_list?: string[];
}

interface GetProductsResponse {
  code: string;
  data: {
    total_products: string;
    products: LazadaProduct[];
  };
  request_id?: string;
}

/**
 * Create HMAC-SHA256 signature for Lazada API request.
 */
function createSignature(
  path: string,
  params: Record<string, string>,
  appSecret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const signString = `${path}${sortedKeys.map((k) => `${k}${params[k]}`).join("")}`;
  return createHmac("sha256", appSecret)
    .update(signString)
    .digest("hex")
    .toUpperCase();
}

/**
 * Get products from Lazada with proper filtering.
 * Follows official API documentation: https://open.lazada.com/apps/doc/api?path=%2Fproducts%2Fget
 *
 * @param params - Query parameters (filter is mandatory per docs)
 * @returns Array of products
 */
export async function getProductsCustom(
  params: GetProductsParams = {},
): Promise<LazadaProduct[]> {
  const appKey = getEnvVar("LAZADA_APP_KEY");
  const appSecret = getEnvVar("LAZADA_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("Lazada is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET.");
  }

  // Find the active seller's shop
  const { getActiveSellerId } = await import("./server");
  const activeSellerId = getActiveSellerId();

  let shop;
  if (activeSellerId) {
    shop = await prisma.lazadaShop.findFirst({
      where: { sellerId: activeSellerId },
    });
  } else {
    shop = await prisma.lazadaShop.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!shop?.accessToken) {
    throw new Error("No Lazada shop found or access token missing.");
  }

  const endpoint = getLazadaEndpoint(shop.countryCode);
  const path = "/products/get";

  // Build request parameters - filter is MANDATORY per API docs
  const requestParams: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    access_token: shop.accessToken,
    filter: params.filter || "live", // Default to "live" products
  };

  // Add optional parameters
  if (params.limit !== undefined) {
    requestParams.limit = String(Math.min(params.limit, 50)); // Max 50 per docs
  }
  if (params.offset !== undefined) {
    requestParams.offset = String(Math.min(params.offset, 10000)); // Max 10000
  }
  if (params.create_after) {
    requestParams.create_after = params.create_after;
  }
  if (params.update_after) {
    requestParams.update_after = params.update_after;
  }
  if (params.create_before) {
    requestParams.create_before = params.create_before;
  }
  if (params.update_before) {
    requestParams.update_before = params.update_before;
  }
  if (params.options !== undefined) {
    requestParams.options = String(params.options);
  }
  if (params.sku_seller_list && params.sku_seller_list.length > 0) {
    requestParams.sku_seller_list = JSON.stringify(params.sku_seller_list);
  }

  // Create signature
  const signature = createSignature(path, requestParams, appSecret);

  // Build query string
  const queryString = Object.entries(requestParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${endpoint}${path}?${queryString}&sign=${signature}`;

  // Make request
  const response = await fetch(url);
  const data: GetProductsResponse = await response.json();

  if (data.code !== "0") {
    const errorMsg = data.data?.toString() || `API error code: ${data.code}`;
    logger.error(`[Lazada Custom API] GetProducts failed: ${errorMsg}`);
    throw new Error(`Lazada API error: ${errorMsg}`);
  }

  return data.data?.products || [];
}

/**
 * Get ALL products from Lazada with auto-pagination.
 * Uses date-based scrolling (recommended) instead of deprecated offset.
 *
 * @param filter - Product filter (default: "live")
 * @returns Array of all products
 */
export async function getAllProductsCustom(
  filter: "all" | "live" | "inactive" | "deleted" | "pending" | "rejected" | "sold-out" = "live",
): Promise<LazadaProduct[]> {
  const allProducts: LazadaProduct[] = [];
  let hasMore = true;
  let lastUpdateTime: string | undefined;

  logger.info(`[Lazada Custom API] Fetching all products with filter: ${filter}`);

  while (hasMore) {
    const params: GetProductsParams = {
      filter,
      limit: 50, // Max per request
    };

    // Use date-based scrolling for pagination (recommended over deprecated offset)
    if (lastUpdateTime) {
      params.update_after = lastUpdateTime;
    }

    const products = await getProductsCustom(params);

    if (products.length === 0) {
      hasMore = false;
    } else {
      allProducts.push(...products);

      // Get the latest update_time from this batch for next page
      const latestUpdate = products
        .map((p) => p.updated_time)
        .filter((t) => t)
        .sort()
        .pop();

      if (latestUpdate) {
        // Convert Unix timestamp to ISO 8601 format for API
        const isoUpdateTime = unixTimestampToISO8601(latestUpdate);
        if (isoUpdateTime !== lastUpdateTime) {
          lastUpdateTime = isoUpdateTime;
        } else {
          // No new updates, stop pagination
          hasMore = false;
        }
      } else {
        // No update_time found, stop pagination
        hasMore = false;
      }

      logger.info(
        `[Lazada Custom API] Fetched ${products.length} products (total: ${allProducts.length})`,
      );
    }
  }

  logger.info(`[Lazada Custom API] Total products fetched: ${allProducts.length}`);
  return allProducts;
}

// ─── Order API Functions ──────────────────────────────────────────────────

interface LazadaOrder {
  order_id: number;
  order_number: string;
  statuses: string[];
  price: string;
  shipping_fee: string;
  payment_method: string;
  customer_first_name: string;
  customer_last_name: string;
  remarks: string;
  created_at: string;
  updated_at: string;
  address_shipping?: Record<string, unknown>;
  address_billing?: Record<string, unknown>;
  voucher_platform?: string;
  voucher_seller?: string;
  voucher_code?: string;
  [key: string]: unknown;
}

export interface OrderItem {
  order_item_id: number;
  item_id: number;
  sku_id: number;
  seller_sku: string;
  shop_sku: string;
  name: string;
  variation: string;
  item_price: string;
  paid_price: string;
  currency: string;
  status: string;
  shipment_provider: string;
  tracking_number: string;
  [key: string]: unknown;
}

interface GetOrdersParams {
  created_after?: string;
  created_before?: string;
  update_after?: string;
  update_before?: string;
  status?: string;
  sort_direction?: "ASC" | "DESC";
  sort_by?: "created_at" | "updated_at";
  offset?: number;
  limit?: number;
}

interface GetOrdersResponse {
  code: string;
  data: {
    count: string;
    countTotal: string;
    orders: LazadaOrder[];
  };
  request_id?: string;
}

interface GetOrderItemsResponse {
  code: string;
  data: {
    order_id: number;
    order_items: OrderItem[];
  }[];
  request_id?: string;
}

// ─── Finance API Functions ────────────────────────────────────────────────

export interface LazadaFinanceTransaction {
  amount?: string;
  transaction_number?: string;
  transaction_date?: string;
  order_no?: string;
  orderItem_no?: string;
  transaction_type?: string;
  fee_type?: string;
  fee_name?: string;
  [key: string]: unknown;
}

interface GetFinanceTransactionDetailsParams {
  start_time: string | Date;
  end_time: string | Date;
  offset?: number;
  limit?: number;
  trans_type?: string;
  trade_order_id?: string;
  trade_order_line_id?: string;
}

interface GetFinanceTransactionDetailsResponse {
  code: string | number;
  data?: LazadaFinanceTransaction[] | string;
  request_id?: string;
  message?: string;
  msg?: string;
}

const FINANCE_MAX_RANGE_MS = 180 * 24 * 60 * 60 * 1000;

function normalizeFinanceDate(value: string | Date, parameter: string): { date: Date; value: string } {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Lazada finance ${parameter} must be a valid date.`);
  }
  const normalized = date.toISOString().slice(0, 10);
  return { date: new Date(`${normalized}T00:00:00.000Z`), value: normalized };
}

/** Lazada rejects finance query windows that are 180 days or longer. */
export function validateFinanceDateRange(startTime: string | Date, endTime: string | Date): {
  startTime: string;
  endTime: string;
} {
  const start = normalizeFinanceDate(startTime, "start_time");
  const end = normalizeFinanceDate(endTime, "end_time");
  const range = end.date.getTime() - start.date.getTime();
  if (range < 0) throw new Error("Lazada finance end_time must not be before start_time.");
  if (range >= FINANCE_MAX_RANGE_MS) {
    throw new Error("Lazada finance end_time - start_time must be less than 180 days.");
  }
  return { startTime: start.value, endTime: end.value };
}

/** Fetch one signed page of transaction details from Lazada's finance API. */
export async function getFinanceTransactionDetailsCustom(
  params: GetFinanceTransactionDetailsParams,
): Promise<LazadaFinanceTransaction[]> {
  const appKey = getEnvVar("LAZADA_APP_KEY");
  const appSecret = getEnvVar("LAZADA_APP_SECRET");
  if (!appKey || !appSecret) {
    throw new Error("Lazada is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET.");
  }

  const { getActiveSellerId } = await import("./server");
  const activeSellerId = getActiveSellerId();
  const shop = activeSellerId
    ? await prisma.lazadaShop.findFirst({ where: { sellerId: activeSellerId } })
    : await prisma.lazadaShop.findFirst({ orderBy: { updatedAt: "desc" } });

  if (!shop?.accessToken) throw new Error("No Lazada shop found or access token missing.");

  const { startTime, endTime } = validateFinanceDateRange(params.start_time, params.end_time);
  const path = "/finance/transaction/details/get";
  const requestParams: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    access_token: shop.accessToken,
    start_time: startTime,
    end_time: endTime,
  };
  if (params.offset !== undefined) requestParams.offset = String(Math.max(0, params.offset));
  if (params.limit !== undefined) requestParams.limit = String(Math.min(Math.max(1, params.limit), 500));
  if (params.trans_type) requestParams.trans_type = params.trans_type;
  if (params.trade_order_id) requestParams.trade_order_id = params.trade_order_id;
  if (params.trade_order_line_id) requestParams.trade_order_line_id = params.trade_order_line_id;

  const signature = createSignature(path, requestParams, appSecret);
  const queryString = Object.entries(requestParams)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const response = await fetch(`${getLazadaEndpoint(shop.countryCode)}${path}?${queryString}&sign=${signature}`);
  const data: GetFinanceTransactionDetailsResponse = await response.json();

  if (String(data.code) !== "0") {
    const errorMsg = data.msg || data.message || (typeof data.data === "string" ? data.data : undefined) || `API error code: ${data.code}`;
    logger.error(`[Lazada Custom API] GetFinanceTransactionDetails failed: ${errorMsg}`);
    throw new Error(`Lazada API error: ${errorMsg}`);
  }
  return Array.isArray(data.data) ? data.data : [];
}

/** Fetch all finance transaction pages using Lazada's documented 500-row limit. */
export async function getAllFinanceTransactionDetailsCustom(
  params: Omit<GetFinanceTransactionDetailsParams, "offset" | "limit">,
): Promise<LazadaFinanceTransaction[]> {
  const transactions: LazadaFinanceTransaction[] = [];
  const pageSize = 500;
  let offset = 0;

  while (true) {
    const page = await getFinanceTransactionDetailsCustom({ ...params, offset, limit: pageSize });
    transactions.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  logger.info(`[Lazada Custom API] Total finance transactions fetched: ${transactions.length}`);
  return transactions;
}

/**
 * Get orders from Lazada with proper parameters.
 * Follows official API documentation: https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget
 *
 * @param params - Query parameters (created_after or update_after is mandatory)
 * @returns Array of orders
 */
export async function getOrdersCustom(
  params: GetOrdersParams = {},
): Promise<LazadaOrder[]> {
  const appKey = getEnvVar("LAZADA_APP_KEY");
  const appSecret = getEnvVar("LAZADA_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("Lazada is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET.");
  }

  const { getActiveSellerId } = await import("./server");
  const activeSellerId = getActiveSellerId();

  let shop;
  if (activeSellerId) {
    shop = await prisma.lazadaShop.findFirst({
      where: { sellerId: activeSellerId },
    });
  } else {
    shop = await prisma.lazadaShop.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!shop?.accessToken) {
    throw new Error("No Lazada shop found or access token missing.");
  }

  const endpoint = getLazadaEndpoint(shop.countryCode);
  const path = "/orders/get";

  // Build request parameters
  const requestParams: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    access_token: shop.accessToken,
  };

  // Add optional parameters
  if (params.created_after) {
    requestParams.created_after = params.created_after;
  }
  if (params.created_before) {
    requestParams.created_before = params.created_before;
  }
  if (params.update_after) {
    requestParams.update_after = params.update_after;
  }
  if (params.update_before) {
    requestParams.update_before = params.update_before;
  }
  if (params.status) {
    requestParams.status = params.status;
  }
  if (params.sort_direction) {
    requestParams.sort_direction = params.sort_direction;
  }
  if (params.sort_by) {
    requestParams.sort_by = params.sort_by;
  }
  if (params.offset !== undefined) {
    requestParams.offset = String(params.offset);
  }
  if (params.limit !== undefined) {
    requestParams.limit = String(Math.min(params.limit, 100)); // Max 100 per docs
  }

  const signature = createSignature(path, requestParams, appSecret);

  const queryString = Object.entries(requestParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${endpoint}${path}?${queryString}&sign=${signature}`;

  const response = await fetch(url);
  const data: GetOrdersResponse = await response.json();

  if (data.code !== "0") {
    const errorMsg = data.data?.toString() || `API error code: ${data.code}`;
    logger.error(`[Lazada Custom API] GetOrders failed: ${errorMsg}`);
    throw new Error(`Lazada API error: ${errorMsg}`);
  }

  return data.data?.orders || [];
}

/**
 * Get ALL orders from Lazada with auto-pagination.
 * Uses offset-based pagination (max 5000 offset per API docs).
 *
 * @param params - Query parameters
 * @returns Array of all orders
 */
export async function getAllOrdersCustom(
  params: Omit<GetOrdersParams, "offset" | "limit"> = {},
): Promise<LazadaOrder[]> {
  const allOrders: LazadaOrder[] = [];
  let offset = 0;
  const pageSize = 100;
  let totalCount = 0;
  let page = 0;

  logger.info(`[Lazada Custom API] Fetching all orders`);

  while (offset < 5000) { // Max offset per API docs
    const orders = await getOrdersCustom({
      ...params,
      offset,
      limit: pageSize,
    });

    if (orders.length === 0) break;

    allOrders.push(...orders);
    page++;

    logger.info(
      `[Lazada Custom API] Fetched ${orders.length} orders (total: ${allOrders.length})`,
    );

    // If we got fewer than pageSize, we've reached the end
    if (orders.length < pageSize) break;

    offset += pageSize;
  }

  logger.info(`[Lazada Custom API] Total orders fetched: ${allOrders.length}`);
  return allOrders;
}

/**
 * Get order items for multiple orders.
 * Follows official API documentation: https://open.lazada.com/apps/doc/api?path=%2Forders%2Fitems%2Fget
 *
 * @param orderIds - Array of order IDs (max 50 per request)
 * @returns Array of order items grouped by order
 */
export async function getMultipleOrderItemsCustom(
  orderIds: number[],
): Promise<Array<{ order_id: number; order_items: OrderItem[] }>> {
  const appKey = getEnvVar("LAZADA_APP_KEY");
  const appSecret = getEnvVar("LAZADA_APP_SECRET");

  if (!appKey || !appSecret) {
    throw new Error("Lazada is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET.");
  }

  const { getActiveSellerId } = await import("./server");
  const activeSellerId = getActiveSellerId();

  let shop;
  if (activeSellerId) {
    shop = await prisma.lazadaShop.findFirst({
      where: { sellerId: activeSellerId },
    });
  } else {
    shop = await prisma.lazadaShop.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!shop?.accessToken) {
    throw new Error("No Lazada shop found or access token missing.");
  }

  const endpoint = getLazadaEndpoint(shop.countryCode);
  const path = "/orders/items/get";

  const requestParams: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    access_token: shop.accessToken,
    order_ids: `[${orderIds.join(",")}]`,
  };

  const signature = createSignature(path, requestParams, appSecret);

  const queryString = Object.entries(requestParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${endpoint}${path}?${queryString}&sign=${signature}`;

  const response = await fetch(url);
  const data: GetOrderItemsResponse = await response.json();

  if (data.code !== "0") {
    const errorMsg = data.data?.toString() || `API error code: ${data.code}`;
    logger.error(`[Lazada Custom API] GetMultipleOrderItems failed: ${errorMsg}`);
    throw new Error(`Lazada API error: ${errorMsg}`);
  }

  return Array.isArray(data.data) ? data.data : [];
}
