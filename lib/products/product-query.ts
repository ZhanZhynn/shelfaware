/**
 * Shared Prisma where clauses for Product queries.
 * Catalog/list UIs must exclude soft-deleted products (deletedAt set).
 *
 * MongoDB: legacy rows may omit `deletedAt` entirely (pre-migration).
 * `deletedAt: null` alone does NOT match missing fields — use OR + isSet: false.
 */

import type { Prisma } from "@prisma/client";

/**
 * Active catalog products: not archived.
 * - deletedAt is null (explicit)
 * - deletedAt field absent (legacy documents before soft-delete migration)
 */
export const productNotDeletedWhere = {
  OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
} satisfies Prisma.ProductWhereInput;

/**
 * Merge catalog filter with additional where fields (userId, supplierId, id, etc.).
 */
export function mergeProductListWhere(
  where: Prisma.ProductWhereInput,
): Prisma.ProductWhereInput {
  return {
    AND: [productNotDeletedWhere, where],
  };
}

/** True when product row is archived (soft-deleted). */
export function isProductArchived(
  product: { deletedAt?: Date | null },
): boolean {
  return product.deletedAt != null;
}
