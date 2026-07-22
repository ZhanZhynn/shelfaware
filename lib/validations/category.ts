/**
 * Category validation schemas
 * Centralized Zod schemas for category-related forms and API requests
 */

import { z } from "zod";

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(100, "Category name must be 100 characters or less");

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
 * API request body for POST /api/categories (userId from session only)
 */
export const createCategoryBodySchema = z.object({
  name: categoryNameSchema,
  status: z.boolean().optional().default(true),
  description: optionalDescriptionSchema,
  notes: optionalNotesSchema,
  workspaceId: z.string().min(1, "Workspace ID is required").optional(),
});

/**
 * Category creation schema (includes userId for bulk/import flows)
 */
export const createCategorySchema = createCategoryBodySchema.extend({
  userId: z.string().min(1, "User ID is required"),
});

/**
 * API request body for PUT /api/categories
 */
export const updateCategoryBodySchema = z.object({
  id: z.string().min(1, "Category ID is required"),
  name: categoryNameSchema,
  status: z.boolean().optional(),
  description: optionalDescriptionSchema,
  notes: optionalNotesSchema,
});

/**
 * Category update schema (alias for API compatibility)
 */
export const updateCategorySchema = updateCategoryBodySchema;

/**
 * Category form data type
 */
export type CategoryFormData = z.infer<typeof createCategorySchema>;
