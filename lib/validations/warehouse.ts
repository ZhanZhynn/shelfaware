/**
 * Warehouse validation schemas
 * Zod schemas for warehouse API POST/PUT bodies (userId from session only)
 */

import { z } from "zod";

const warehouseNameSchema = z
  .string()
  .trim()
  .min(1, "Warehouse name is required")
  .max(100, "Warehouse name must be 100 characters or less");

const optionalWarehouseTextSchema = z
  .string()
  .max(500)
  .nullable()
  .optional();

/**
 * API request body for POST /api/warehouses
 */
export const createWarehouseBodySchema = z.object({
  name: warehouseNameSchema,
  address: optionalWarehouseTextSchema,
  type: optionalWarehouseTextSchema,
  status: z.boolean().optional().default(true),
  workspaceId: z.string().min(1).optional(),
});

/**
 * API request body for PUT /api/warehouses
 */
export const updateWarehouseBodySchema = z.object({
  id: z.string().min(1, "Warehouse ID is required"),
  name: warehouseNameSchema,
  address: optionalWarehouseTextSchema,
  type: optionalWarehouseTextSchema,
  status: z.boolean().optional(),
});

export type CreateWarehouseBody = z.infer<typeof createWarehouseBodySchema>;
export type UpdateWarehouseBody = z.infer<typeof updateWarehouseBodySchema>;
