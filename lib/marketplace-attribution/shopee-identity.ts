export type LegacyShopeeLine = { shopeeItemId: number | null; sku: string | null };
export type NonvariantShopeeCatalogProduct = { shopeeItemId: number; itemSku: string | null };

/**
 * Old order syncs omitted item IDs for non-variant lines. A snapshot may be
 * recovered only when its durable SKU points to one catalog item in this shop.
 */
export function resolveShopeeProductId(line: LegacyShopeeLine, products: NonvariantShopeeCatalogProduct[]) {
  if (line.shopeeItemId != null) return line.shopeeItemId;
  const candidates = new Set<number>();
  if (line.sku) for (const product of products) if (product.itemSku === line.sku) candidates.add(product.shopeeItemId);
  return candidates.size === 1 ? [...candidates][0]! : null;
}
