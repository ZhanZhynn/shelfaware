import { describe, expect, it, vi } from "vitest";

const shopifyGraphQL = vi.hoisted(() => vi.fn());
vi.mock("./server", () => ({
  shopifyGraphQL,
  PRODUCTS_QUERY: "products",
  ORDERS_QUERY: "orders",
  ORDER_LINE_ITEMS_QUERY: "order-lines",
  FINANCE_ORDERS_QUERY: "finance-orders",
}));

import { fetchAllOrderLineItems } from "./graphql-client";
import type { ShopifyOrderNode } from "./types";

const line = (id: number) => ({
  id: `gid://shopify/LineItem/${id}`,
  name: "Line",
  title: "Line",
  quantity: 1,
  currentQuantity: 1,
  unfulfilledQuantity: 1,
  sku: null,
  product: null,
  variant: null,
  originalUnitPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } },
  discountedUnitPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } },
  discountedTotalSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } },
});

describe("Shopify nested order pagination", () => {
  it("fetches all lines beyond Shopify's initial 100-line page", async () => {
    const order = { id: "gid://shopify/Order/1", lineItems: { nodes: Array.from({ length: 100 }, (_, index) => line(index)), pageInfo: { hasNextPage: true, endCursor: "page-1" } } } as ShopifyOrderNode;
    shopifyGraphQL.mockResolvedValue({ node: { lineItems: { nodes: [line(100)], pageInfo: { hasNextPage: false, endCursor: "page-2" } } } });

    const result = await fetchAllOrderLineItems("shop.myshopify.com", "token", order);

    expect(result.lineItems.nodes).toHaveLength(101);
    expect(result.lineItems.pageInfo).toEqual({ hasNextPage: false, endCursor: "page-2" });
    expect(shopifyGraphQL).toHaveBeenCalledWith("shop.myshopify.com", "token", "order-lines", { id: order.id, after: "page-1" });
  });

  it("returns an explicit incomplete result when a nested page fails", async () => {
    const order = { id: "gid://shopify/Order/1", lineItems: { nodes: [line(1)], pageInfo: { hasNextPage: true, endCursor: "page-1" } } } as ShopifyOrderNode;
    shopifyGraphQL.mockRejectedValue(new Error("page failed"));

    const result = await fetchAllOrderLineItems("shop.myshopify.com", "token", order);

    expect(result.lineItems.pageInfo.hasNextPage).toBe(true);
    expect(result.lineItems.nodes).toEqual([line(1)]);
    expect(result.lineItemsFetchError).toBe("page failed");
  });
});
