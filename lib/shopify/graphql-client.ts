/**
 * Shopify GraphQL Client
 * Higher-level wrapper around the raw shopifyGraphQL() function from server.ts.
 * Provides domain-specific query functions for products and orders.
 */

import { shopifyGraphQL, PRODUCTS_QUERY, ORDERS_QUERY, ORDER_LINE_ITEMS_QUERY, FINANCE_ORDERS_QUERY } from "./server";
import type {
  ShopifyProductNode,
  ShopifyProductsResponse,
  ShopifyOrderNode,
  ShopifyOrdersResponse,
  ShopifyOrderLineItemsResponse,
  ShopifyFinanceOrderNode,
  ShopifyFinanceOrdersResponse,
} from "./types";

// ─── Product Queries ───────────────────────────────────────────────────────

/**
 * Fetch all products with cursor-based pagination.
 * @param shopDomain The shop domain (e.g. "mystore.myshopify.com")
 * @param accessToken The OAuth access token
 * @param query Optional search query (e.g. "status:active")
 */
export async function fetchAllProducts(
  shopDomain: string,
  accessToken: string,
  query?: string,
): Promise<ShopifyProductNode[]> {
  const allProducts: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: 50, after: cursor };
    if (query) variables.query = query;

    const data: ShopifyProductsResponse = await shopifyGraphQL<ShopifyProductsResponse>(
      shopDomain,
      accessToken,
      PRODUCTS_QUERY,
      variables,
    );

    allProducts.push(
      ...data.products.nodes.map((product) => ({
        ...product,
        currencyCode: data.shop.currencyCode,
      })),
    );
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
    pageCount++;
  }

  return allProducts;
}

// ─── Order Queries ─────────────────────────────────────────────────────────

/**
 * Fetch orders with cursor-based pagination, optionally filtered by date.
 * @param shopDomain The shop domain
 * @param accessToken The OAuth access token
 * @param createdAfter Optional ISO 8601 date string (defaults to 15 days ago)
 */
export async function fetchAllOrders(
  shopDomain: string,
  accessToken: string,
  createdAfter?: string,
): Promise<ShopifyOrderNode[]> {
  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  // Default to 15 days ago
  const filterDate = createdAfter
    ? createdAfter
    : new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const queryString = `created_at:>=${filterDate}`;

  while (hasNextPage) {
    const data: ShopifyOrdersResponse = await shopifyGraphQL<ShopifyOrdersResponse>(
      shopDomain,
      accessToken,
      ORDERS_QUERY,
      { first: 50, after: cursor, query: queryString },
    );

    for (const order of data.orders.nodes) {
      allOrders.push(await fetchAllOrderLineItems(shopDomain, accessToken, order));
    }
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  return allOrders;
}

/** Fetch every nested line-item page before an order can replace local facts. */
export async function fetchAllOrderLineItems(
  shopDomain: string,
  accessToken: string,
  order: ShopifyOrderNode,
): Promise<ShopifyOrderNode> {
  const nodes = [...order.lineItems.nodes];
  let { hasNextPage, endCursor } = order.lineItems.pageInfo;

  try {
    while (hasNextPage) {
      if (!endCursor) {
        throw new Error(`Shopify order ${order.id} indicated another line-item page without a cursor`);
      }
      const data = await shopifyGraphQL<ShopifyOrderLineItemsResponse>(
        shopDomain,
        accessToken,
        ORDER_LINE_ITEMS_QUERY,
        { id: order.id, after: endCursor },
      );
      if (!data.node) throw new Error(`Shopify order ${order.id} was not found while fetching line items`);
      nodes.push(...data.node.lineItems.nodes);
      ({ hasNextPage, endCursor } = data.node.lineItems.pageInfo);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...order,
      // Keep the partial response only for diagnostics. The sync layer never persists it as facts.
      lineItems: { nodes, pageInfo: { hasNextPage: true, endCursor } },
      lineItemsFetchError: message,
    };
  }

  return {
    ...order,
    lineItems: { nodes, pageInfo: { hasNextPage: false, endCursor } },
  };
}

// ─── Finance Queries ───────────────────────────────────────────────────────

/**
 * Fetch orders updated since a date with their documented payment transactions
 * and refund records. Updated-at filtering catches refunds on older orders.
 */
export async function fetchAllFinanceOrders(
  shopDomain: string,
  accessToken: string,
  updatedAfter?: string,
): Promise<ShopifyFinanceOrderNode[]> {
  const allOrders: ShopifyFinanceOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  const filterDate = updatedAfter
    ? updatedAfter
    : new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const queryString = `updated_at:>=${filterDate}`;

  while (hasNextPage) {
    const data: ShopifyFinanceOrdersResponse = await shopifyGraphQL<ShopifyFinanceOrdersResponse>(
      shopDomain,
      accessToken,
      FINANCE_ORDERS_QUERY,
      { first: 50, after: cursor, query: queryString },
    );

    allOrders.push(...data.orders.nodes);
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  return allOrders;
}

/**
 * Fetch a single page of products (for list views).
 */
export async function fetchProductsPage(
  shopDomain: string,
  accessToken: string,
  first: number = 50,
  after: string | null = null,
  query?: string,
): Promise<ShopifyProductsResponse> {
  const variables: Record<string, unknown> = { first, after };
  if (query) variables.query = query;

  return shopifyGraphQL<ShopifyProductsResponse>(
    shopDomain,
    accessToken,
    PRODUCTS_QUERY,
    variables,
  );
}

/**
 * Fetch a single page of orders (for list views).
 */
export async function fetchOrdersPage(
  shopDomain: string,
  accessToken: string,
  first: number = 50,
  after: string | null = null,
  query?: string,
): Promise<ShopifyOrdersResponse> {
  const variables: Record<string, unknown> = { first, after };
  if (query) variables.query = query;

  return shopifyGraphQL<ShopifyOrdersResponse>(
    shopDomain,
    accessToken,
    ORDERS_QUERY,
    variables,
  );
}
