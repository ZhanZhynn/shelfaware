/**
 * Lazada validation schemas
 * Zod schemas for Lazada sync, product list, order list queries.
 */

import { z } from "zod";

// --- Sync Trigger ---
export const lazadaSyncBodySchema = z.object({
  sellerId: z.string().min(1, "Seller ID is required"),
  syncType: z.enum(["products", "orders", "all"]).default("all"),
});

export type LazadaSyncBody = z.infer<typeof lazadaSyncBodySchema>;

// --- Product List Query ---
export const lazadaProductListQuerySchema = z.object({
  sellerId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

export type LazadaProductListQuery = z.infer<typeof lazadaProductListQuerySchema>;

// --- Order List Query ---
export const lazadaOrderListQuerySchema = z.object({
  sellerId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  createdAfter: z.string().optional(),
});

export type LazadaOrderListQuery = z.infer<typeof lazadaOrderListQuerySchema>;

// --- Callback Query ---
export const lazadaCallbackQuerySchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  state: z.string().optional(),
});

export type LazadaCallbackQuery = z.infer<typeof lazadaCallbackQuerySchema>;
