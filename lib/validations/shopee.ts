/**
 * Shopee validation schemas
 * Zod schemas for Shopee sync, product list, order list queries.
 */

import { z } from "zod";

// --- Sync Trigger ---
export const shopeeSyncBodySchema = z.object({
  shopId: z.number().int().positive("Shop ID is required"),
  syncType: z.enum(["products", "orders", "returns", "ads", "all"]).default("all"),
});

export type ShopeeSyncBody = z.infer<typeof shopeeSyncBodySchema>;

// --- Product List Query ---
export const shopeeProductListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

export type ShopeeProductListQuery = z.infer<typeof shopeeProductListQuerySchema>;

// --- Order List Query ---
export const shopeeOrderListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  timeFrom: z.coerce.number().int().optional(),
  timeTo: z.coerce.number().int().optional(),
});

export type ShopeeOrderListQuery = z.infer<typeof shopeeOrderListQuerySchema>;

// --- Shop Disconnect ---
export const shopeeShopDisconnectSchema = z.object({
  shopId: z.string().min(1, "Shop ID is required"),
});

export type ShopeeShopDisconnect = z.infer<typeof shopeeShopDisconnectSchema>;

// --- Callback Query ---
export const shopeeCallbackQuerySchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  shop_id: z.coerce.number().int().positive("Shop ID is required"),
  state: z.string().optional(),
});

export type ShopeeCallbackQuery = z.infer<typeof shopeeCallbackQuerySchema>;
