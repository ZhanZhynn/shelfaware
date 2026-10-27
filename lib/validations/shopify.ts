/**
 * Shopify validation schemas
 * Zod schemas for Shopify sync, product list, order list, callback queries.
 */

import { z } from "zod";

// --- Sync Trigger ---
export const shopifySyncBodySchema = z.object({
  shopId: z.string().min(1, "Shop ID is required"),
  syncType: z.enum(["products", "orders", "finance", "all"]).default("all"),
  daysBack: z.coerce.number().int().positive().max(365).optional(),
});

export type ShopifySyncBody = z.infer<typeof shopifySyncBodySchema>;

// --- Product List Query ---
export const shopifyProductListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

export type ShopifyProductListQuery = z.infer<typeof shopifyProductListQuerySchema>;

// --- Order List Query ---
export const shopifyOrderListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  createdAfter: z.string().optional(),
});

export type ShopifyOrderListQuery = z.infer<typeof shopifyOrderListQuerySchema>;

// --- Callback Query ---
export const shopifyCallbackQuerySchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  hmac: z.string().min(1, "HMAC signature is required"),
  shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  host: z.string().optional(),
  timestamp: z.string().regex(/^\d{1,16}$/),
});

export type ShopifyCallbackQuery = z.infer<typeof shopifyCallbackQuerySchema>;

// --- Auth Query (for store domain input) ---
export const shopifyAuthQuerySchema = z.object({
  shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "Invalid Shopify store domain"),
});

export type ShopifyAuthQuery = z.infer<typeof shopifyAuthQuerySchema>;
