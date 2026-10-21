import { beforeEach, describe, expect, it, vi } from "vitest";

const shopifyGraphQL = vi.hoisted(() => vi.fn());
vi.mock("./server", () => ({
  shopifyGraphQL,
  PRODUCTS_QUERY: "products",
  ORDERS_QUERY: "orders",
  ORDER_LINE_ITEMS_QUERY: "order-lines",
  FINANCE_ORDERS_QUERY: "finance-orders",
}));

import { fetchAllOrderLineItems, fetchAllOrders, fetchAllFinanceOrders } from "./graphql-client";
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

beforeEach(() => vi.resetAllMocks());

describe("Shopify bounded order and finance retrieval", () => {
  it.each([
    { fetch: fetchAllOrders, query: "orders", field: "created_at" },
    { fetch: fetchAllFinanceOrders, query: "finance-orders", field: "updated_at" },
  ])("quotes both $field timestamp bounds on every page", async ({ fetch, query, field }) => {
    shopifyGraphQL.mockResolvedValueOnce({ orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "page-2" } } });
    shopifyGraphQL.mockResolvedValueOnce({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    await fetch("shop.myshopify.com", "token", "2026-10-21T00:00:00+08:00", "2026-10-21T23:59:59+08:00");
    const filter = `${field}:>="2026-10-20T16:00:00.000Z" ${field}:<="2026-10-21T15:59:59.000Z"`;
    expect(shopifyGraphQL).toHaveBeenNthCalledWith(1, "shop.myshopify.com", "token", query, { first: 50, after: null, query: filter });
    expect(shopifyGraphQL).toHaveBeenNthCalledWith(2, "shop.myshopify.com", "token", query, { first: 50, after: "page-2", query: filter });
  });
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
