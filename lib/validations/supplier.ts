/**
 * Supplier validation schemas
 * Centralized Zod schemas for supplier-related forms and API requests
 */

import { z } from "zod";

const supplierNameSchema = z
  .string()
  .trim()
  .min(1, "Supplier name is required")
  .max(100, "Supplier name must be 100 characters or less");

const optionalDescriptionSchema = z
  .string()
  .max(500, "Description must be 500 characters or less")
  .nullable()
  .optional();

const optionalNotesSchema = z
  .string()
  .max(1000, "Notes must be 1000 characters or less")
  .nullable()
  .optional();

/**
 * API request body for POST /api/suppliers (userId from session only)
 */
export const createSupplierBodySchema = z.object({
  name: supplierNameSchema,
  status: z.boolean().optional().default(true),
  description: optionalDescriptionSchema,
  notes: optionalNotesSchema,
  workspaceId: z.string().min(1, "Workspace ID is required").optional(),
});

/**
 * Supplier creation schema (includes userId for bulk/import flows)
 */
export const createSupplierSchema = createSupplierBodySchema.extend({
  userId: z.string().min(1, "User ID is required"),
});

/**
 * API request body for PUT /api/suppliers
 */
export const updateSupplierBodySchema = z.object({
  id: z.string().min(1, "Supplier ID is required"),
  name: supplierNameSchema,
  status: z.boolean().optional(),
  description: optionalDescriptionSchema,
  notes: optionalNotesSchema,
});

/**
 * Supplier update schema (alias for API compatibility)
 */
export const updateSupplierSchema = updateSupplierBodySchema;

/**
 * Supplier form data type
 */
export type SupplierFormData = z.infer<typeof createSupplierSchema>;
