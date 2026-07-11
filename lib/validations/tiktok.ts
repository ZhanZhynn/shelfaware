/**
 * TikTok Shop validation schemas
 * Zod schemas for TikTok sync, product list, order list, callback queries.
 */

import { z } from "zod";

// --- Sync Trigger ---
export const tiktokSyncBodySchema = z.object({
  shopId: z.string().min(1, "Shop ID is required"),
  syncType: z.enum(["products", "orders", "all"]).default("all"),
});

export type TiktokSyncBody = z.infer<typeof tiktokSyncBodySchema>;

// --- Product List Query ---
export const tiktokProductListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

export type TiktokProductListQuery = z.infer<typeof tiktokProductListQuerySchema>;

// --- Order List Query ---
export const tiktokOrderListQuerySchema = z.object({
  shopId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  createdAfter: z.string().optional(),
});

export type TiktokOrderListQuery = z.infer<typeof tiktokOrderListQuerySchema>;

// --- Callback Query ---
export const tiktokCallbackQuerySchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  state: z.string().optional(),
});

export type TiktokCallbackQuery = z.infer<typeof tiktokCallbackQuerySchema>;
