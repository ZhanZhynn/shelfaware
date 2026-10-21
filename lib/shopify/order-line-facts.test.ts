import { describe, expect, it } from "vitest";
import { areShopifyOrderLineItemsComplete, isShopifyOrderLineItemsSafeForAttribution, shopifyOrderLineSourceFacts } from "./order-line-facts";
import type { ShopifyLineItemNode } from "./types";

function lineItem(overrides: Partial<ShopifyLineItemNode> = {}): ShopifyLineItemNode {
  return {
    id: "gid://shopify/LineItem/1",
    name: "Blue shirt",
    title: "Shirt",
    quantity: 3,
    currentQuantity: 1,
    unfulfilledQuantity: 1,
    sku: "SHIRT-BLUE",
    product: { id: "gid://shopify/Product/10" },
    variant: { id: "gid://shopify/ProductVariant/20", title: "Blue", sku: "SHIRT-BLUE", product: { id: "gid://shopify/Product/10" } },
    originalUnitPriceSet: { shopMoney: { amount: "12.500", currencyCode: "USD" } },
    discountedUnitPriceSet: { shopMoney: { amount: "10.000", currencyCode: "USD" } },
    discountedTotalSet: { shopMoney: { amount: "30.000", currencyCode: "USD" } },
    ...overrides,
  };
}

describe("Shopify order-line source facts", () => {
  it("persists upstream GIDs and original ordered money semantics independently of local variants", () => {
    expect(shopifyOrderLineSourceFacts(lineItem())).toMatchObject({
      shopifyProductGid: "gid://shopify/Product/10",
      shopifyVariantGid: "gid://shopify/ProductVariant/20",
      orderedQuantity: 3,
      originalUnitPriceAmount: "12.500",
      originalUnitPriceScale: 3,
      discountedLineAmount: "30.000",
      discountedLineCurrency: "USD",
    });
  });

  it("retains original ordered quantity rather than mutable current quantity", () => {
    const facts = shopifyOrderLineSourceFacts(lineItem({ quantity: 4, currentQuantity: 1 }));
    expect(facts.orderedQuantity).toBe(4);
  });

  it("marks an order incomplete when Shopify reports more than the first 100 lines", () => {
    expect(areShopifyOrderLineItemsComplete({ pageInfo: { hasNextPage: true } })).toBe(false);
    expect(areShopifyOrderLineItemsComplete({ pageInfo: { hasNextPage: false } })).toBe(true);
  });

  it("treats missing rollout completeness state as unsafe", () => {
    // Mongo defaults apply only to newly written documents; a legacy document has no field.
    expect(isShopifyOrderLineItemsSafeForAttribution(undefined)).toBe(false);
    expect(isShopifyOrderLineItemsSafeForAttribution(null)).toBe(false);
    expect(isShopifyOrderLineItemsSafeForAttribution(false)).toBe(false);
    expect(isShopifyOrderLineItemsSafeForAttribution(true)).toBe(true);
  });

  it("handles absent products and variants without requiring local catalog resolution", () => {
    expect(shopifyOrderLineSourceFacts(lineItem({ product: null, variant: null }))).toMatchObject({
      shopifyProductGid: null,
      shopifyVariantGid: null,
    });
  });

  it.each(["", " ", "12junk", "NaN", "Infinity", "1e3"])("keeps malformed source money unknown rather than coercing %j", (amount) => {
    const bag = { shopMoney: { amount, currencyCode: "USD" } };
    expect(shopifyOrderLineSourceFacts(lineItem({ originalUnitPriceSet: bag, discountedUnitPriceSet: bag, discountedTotalSet: bag }))).toMatchObject({
      originalUnitPriceAmount: null, originalUnitPriceScale: null, originalUnitPriceCurrency: null,
      discountedUnitPriceAmount: null, discountedUnitPriceScale: null, discountedUnitPriceCurrency: null,
      discountedLineAmount: null, discountedLineScale: null, discountedLineCurrency: null,
    });
  });

  it.each(["0", "-0.00", "+0012.340", "9007199254740993.01"])("retains exact source digits, signs and scale for %s", (amount) => {
    const bag = { shopMoney: { amount, currencyCode: "MYR" } };
    const facts = shopifyOrderLineSourceFacts(lineItem({ originalUnitPriceSet: bag }));
    expect(facts.originalUnitPriceAmount).toBe(amount);
    expect(facts.originalUnitPriceScale).toBe(amount.split(".")[1]?.length ?? 0);
    expect(facts.originalUnitPriceCurrency).toBe("MYR");
  });

  it("uses the variant's upstream product identity if the order-line product is absent", () => {
    expect(shopifyOrderLineSourceFacts(lineItem({ product: null }))).toMatchObject({ shopifyProductGid: "gid://shopify/Product/10", shopifyVariantGid: "gid://shopify/ProductVariant/20" });
  });
});
