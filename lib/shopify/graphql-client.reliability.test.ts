import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";
import { buildSchema, parse, validate } from "graphql";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/prisma/client", () => ({ default: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// Keep the actual query documents; mock only the external HTTP boundary.
vi.mock("./server", async (importOriginal) => ({ ...await importOriginal<typeof import("./server")>(), shopifyGraphQL: request }));
import { fetchAllFinanceOrders, fetchAllOrderLineItems, fetchAllOrders, fetchAllProducts, fetchOrdersPage, fetchProductsPage } from "./graphql-client";
import { FINANCE_ORDERS_QUERY, ORDERS_QUERY, ORDER_LINE_ITEMS_QUERY, PRODUCTS_QUERY } from "./server";
import type { ShopifyOrderNode } from "./types";

beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
const lines = (ids: string[], hasNextPage = false, endCursor: string | null = null) => ({ nodes: ids.map((id) => ({ id })), pageInfo: { hasNextPage, endCursor } });

describe("Shopify actual query wiring and nested retrieval", () => {
  it("paginates products and retains shop currency on every product", async () => {
    request.mockResolvedValueOnce({ shop: { currencyCode: "MYR" }, products: { nodes: [{ id: "p1" }], pageInfo: { hasNextPage: true, endCursor: "next" } } }).mockResolvedValueOnce({ shop: { currencyCode: "MYR" }, products: { nodes: [{ id: "p2" }], pageInfo: { hasNextPage: false, endCursor: null } } });
    expect(await fetchAllProducts("shop", "token", "status:active")).toEqual([{ id: "p1", currencyCode: "MYR" }, { id: "p2", currencyCode: "MYR" }]);
    expect(request).toHaveBeenNthCalledWith(2, "shop", "token", PRODUCTS_QUERY, { first: 50, after: "next", query: "status:active" });
  });

  it("fetches nested lines through the actual top-level order client", async () => {
    request.mockResolvedValueOnce({ orders: { nodes: [{ id: "order", lineItems: lines(["line-1"], true, "line-next") }], pageInfo: { hasNextPage: false, endCursor: null } } }).mockResolvedValueOnce({ node: { lineItems: lines(["line-2"], true, "line-last") } }).mockResolvedValueOnce({ node: { lineItems: lines(["line-3"]) } });
    const result = await fetchAllOrders("shop", "token");
    expect(result[0]?.lineItems.nodes.map((item) => item.id)).toEqual(["line-1", "line-2", "line-3"]);
    expect(result[0]?.lineItems.pageInfo.hasNextPage).toBe(false);
    expect(request).toHaveBeenNthCalledWith(1, "shop", "token", ORDERS_QUERY, { first: 50, after: null, query: 'created_at:>="2026-10-06T12:00:00.000Z"' });
    expect(request).toHaveBeenNthCalledWith(2, "shop", "token", ORDER_LINE_ITEMS_QUERY, { id: "order", after: "line-next" });
  });

  it.each([
    { cursor: null, response: null, message: "without a cursor" },
    { cursor: "next", response: { node: null }, message: "not found" },
  ])("marks an incomplete snapshot when the next page is unavailable: $message", async ({ cursor, response, message }) => {
    request.mockResolvedValue(response);
    const source = { id: "order", lineItems: lines(["known"], true, cursor) } as ShopifyOrderNode;
    const result = await fetchAllOrderLineItems("shop", "token", source);
    expect(result.lineItemsFetchError).toContain(message);
    expect(result.lineItems.nodes.map((item) => item.id)).toEqual(["known"]);
    expect(result.lineItems.pageInfo.hasNextPage).toBe(true);
  });

  it("preserves update-time bounds and every returned finance order", async () => {
    request.mockResolvedValueOnce({ orders: { nodes: [{ id: "o1" }], pageInfo: { hasNextPage: true, endCursor: "next" } } }).mockResolvedValueOnce({ orders: { nodes: [{ id: "o2" }], pageInfo: { hasNextPage: false, endCursor: null } } });
    const result = await fetchAllFinanceOrders("shop", "token", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    expect(result.map((item) => item.id)).toEqual(["o1", "o2"]);
    expect(request).toHaveBeenNthCalledWith(2, "shop", "token", FINANCE_ORDERS_QUERY, { first: 50, after: "next", query: 'updated_at:>="2026-10-01T00:00:00.000Z" updated_at:<="2026-10-02T00:00:00.000Z"' });
  });

  it.each([{ fetch: fetchProductsPage, document: PRODUCTS_QUERY }, { fetch: fetchOrdersPage, document: ORDERS_QUERY }])("forwards page filters and defaults using the real query document", async ({ fetch, document }) => {
    request.mockResolvedValue({ sentinel: true });
    await fetch("shop", "token");
    await fetch("shop", "token", 10, "cursor", "status:open");
    expect(request).toHaveBeenNthCalledWith(1, "shop", "token", document, { first: 50, after: null });
    expect(request).toHaveBeenNthCalledWith(2, "shop", "token", document, { first: 10, after: "cursor", query: "status:open" });
  });

  it.each([PRODUCTS_QUERY, ORDERS_QUERY, ORDER_LINE_ITEMS_QUERY, FINANCE_ORDERS_QUERY])("parses each actual GraphQL document", (query) => {
    expect(parse(query).definitions).toHaveLength(1);
  });

  knownGap("KNOWN GAP SHOPIFY-SCHEMA: order transactions are a list, unlike refund transaction connections", () => {
    // Deliberately small, documented schema slice—not a claimed full Shopify schema.
    // https://shopify.dev/docs/api/admin-graphql/latest/objects/Order#field-Order.fields.transactions
    const schema = buildSchema(`
      type Query { orders(first: Int, after: String, query: String, sortKey: OrderSortKeys, reverse: Boolean): OrderConnection! }
      enum OrderSortKeys { UPDATED_AT }
      type OrderConnection { nodes: [Order!]!, pageInfo: PageInfo! }
      type PageInfo { hasNextPage: Boolean!, endCursor: String }
      type Order { id: ID!, updatedAt: String!, transactions(first: Int): [OrderTransaction!]!, refunds(first: Int): [Refund!]! }
      type Refund { id: ID!, createdAt: String!, processedAt: String, totalRefundedSet: MoneyBag!, transactions(first: Int): OrderTransactionConnection! }
      type OrderTransactionConnection { nodes: [OrderTransaction!]! }
      type OrderTransaction { id: ID!, kind: String!, status: String!, gateway: String, createdAt: String!, processedAt: String, amountSet: MoneyBag! }
      type MoneyBag { shopMoney: Money! }
      type Money { amount: String!, currencyCode: String! }
    `);
    expect(validate(schema, parse(FINANCE_ORDERS_QUERY)).map((error) => error.message)).toEqual([]);
  });

  knownGap("KNOWN GAP SHOPIFY-CURSOR: a repeated order cursor must terminate before a third request", async () => {
    let calls = 0;
    request.mockImplementation(async () => {
      if (++calls > 2) throw new Error("test request budget exhausted");
      return { orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } };
    });
    const error = await fetchAllOrders("shop", "token").then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(calls).toBeLessThanOrEqual(2);
  });
});
