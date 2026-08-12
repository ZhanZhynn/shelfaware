import type { ShopifyLineItemNode } from "./types";

type SourceMoneySnapshot = {
  amount: string;
  scale: number;
  currency: string;
};

function sourceMoneySnapshot(money: { amount: string; currencyCode: string }): SourceMoneySnapshot | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(money.amount.trim());
  if (!match) return null;

  return {
    amount: money.amount,
    scale: (match[3] ?? "").length,
    currency: money.currencyCode,
  };
}

/**
 * Source snapshots intentionally do not depend on the local Shopify catalog.
 * Attribution is deferred; these facts preserve the upstream sale identity and money semantics.
 */
export function shopifyOrderLineSourceFacts(item: ShopifyLineItemNode) {
  const originalUnitPrice = sourceMoneySnapshot(item.originalUnitPriceSet.shopMoney);
  const discountedUnitPrice = sourceMoneySnapshot(item.discountedUnitPriceSet.shopMoney);
  const discountedLine = sourceMoneySnapshot(item.discountedTotalSet.shopMoney);

  return {
    shopifyProductGid: item.product?.id ?? item.variant?.product?.id ?? null,
    shopifyVariantGid: item.variant?.id ?? null,
    orderedQuantity: item.quantity,
    originalUnitPriceAmount: originalUnitPrice?.amount ?? null,
    originalUnitPriceScale: originalUnitPrice?.scale ?? null,
    originalUnitPriceCurrency: originalUnitPrice?.currency ?? null,
    discountedUnitPriceAmount: discountedUnitPrice?.amount ?? null,
    discountedUnitPriceScale: discountedUnitPrice?.scale ?? null,
    discountedUnitPriceCurrency: discountedUnitPrice?.currency ?? null,
    discountedLineAmount: discountedLine?.amount ?? null,
    discountedLineScale: discountedLine?.scale ?? null,
    discountedLineCurrency: discountedLine?.currency ?? null,
  };
}

export function areShopifyOrderLineItemsComplete(lineItems: {
  pageInfo: { hasNextPage: boolean };
}): boolean {
  return !lineItems.pageInfo.hasNextPage;
}

/**
 * Shopify attribution is intentionally deferred; its future consumer must require this flag.
 * Legacy Mongo documents without this rollout field are never attribution-safe.
 */
export function isShopifyOrderLineItemsSafeForAttribution(
  isLineItemsComplete: boolean | null | undefined,
): boolean {
  return isLineItemsComplete === true;
}
