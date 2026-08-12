/**
 * Shopify Admin API — TypeScript type definitions.
 * Based on Shopify Admin GraphQL API 2025-07.
 *
 * Key references:
 * - https://shopify.dev/docs/api/admin-graphql/2025-07/objects/Product
 * - https://shopify.dev/docs/api/admin-graphql/2025-07/objects/Order
 * - https://shopify.dev/docs/api/admin-graphql/2025-07/objects/LineItem
 */

// ─── Enums ───────────────────────────────────────────────────────────────

export type ProductStatus = "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";

export type OrderDisplayFinancialStatus =
  | "AUTHORIZED"
  | "EXPIRED"
  | "PAID"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "PENDING"
  | "REFUNDED"
  | "VOIDED";

export type OrderDisplayFulfillmentStatus =
  | "FULFILLED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "OPEN"
  | "PARTIALLY_FULFILLED"
  | "PENDING_FULFILLMENT"
  | "REQUEST_DECLINED"
  | "RESTOCKED"
  | "SCHEDULED"
  | "UNFULFILLED";

// ─── Money ────────────────────────────────────────────────────────────────

export interface MoneyV2 {
  amount: string; // Decimal string e.g. "2000.00"
  currencyCode: string;
}

export interface MoneyBag {
  shopMoney: MoneyV2;
  presentmentMoney?: MoneyV2;
}

// ─── Pagination ───────────────────────────────────────────────────────────

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}

// ─── Products ─────────────────────────────────────────────────────────────

export interface ShopifyProductNode {
  id: string; // gid://shopify/Product/123
  title: string;
  handle: string;
  description: string;
  vendor: string;
  productType: string;
  status: ProductStatus;
  tags: string[];
  totalInventory: number;
  tracksInventory: boolean;
  featuredImage: { url: string } | null;
  createdAt: string;
  updatedAt: string;
  currencyCode: string;
  variants: { nodes: ShopifyProductVariantNode[] };
}

export interface ShopifyProductVariantNode {
  id: string; // gid://shopify/ProductVariant/456
  title: string;
  displayName: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  position: number;
  availableForSale: boolean;
}

export interface ShopifyProductsResponse {
  shop: { currencyCode: string };
  products: {
    nodes: ShopifyProductNode[];
    pageInfo: PageInfo;
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────

export interface ShopifyOrderNode {
  id: string; // gid://shopify/Order/789
  name: string; // e.g. "#1001"
  email: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closed: boolean;
  confirmed: boolean;
  test: boolean;
  note: string | null;
  tags: string[];
  currencyCode: string;
  displayFinancialStatus: OrderDisplayFinancialStatus | null;
  displayFulfillmentStatus: OrderDisplayFulfillmentStatus;
  totalPriceSet: MoneyBag;
  subtotalPriceSet: MoneyBag;
  totalShippingPriceSet: MoneyBag;
  totalTaxSet: MoneyBag | null;
  customer: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  shippingAddress: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    zip: string | null;
  } | null;
  lineItems: {
    nodes: ShopifyLineItemNode[];
    pageInfo: Pick<PageInfo, "hasNextPage" | "endCursor">;
  };
  // Set when nested pagination could not produce a canonical complete item snapshot.
  lineItemsFetchError?: string;
}

export interface ShopifyLineItemNode {
  id: string;
  name: string;
  title: string;
  quantity: number;
  currentQuantity: number;
  unfulfilledQuantity: number;
  sku: string | null;
  product: { id: string } | null;
  variant: { id: string; title: string; sku: string | null; product: { id: string } | null } | null;
  originalUnitPriceSet: MoneyBag;
  discountedUnitPriceSet: MoneyBag;
  discountedTotalSet: MoneyBag;
}

export interface ShopifyOrdersResponse {
  orders: {
    nodes: ShopifyOrderNode[];
    pageInfo: PageInfo;
  };
}

export interface ShopifyOrderLineItemsResponse {
  node: {
    lineItems: ShopifyOrderNode["lineItems"];
  } | null;
}

// ─── Finance ──────────────────────────────────────────────────────────────

export interface ShopifyOrderTransactionNode {
  id: string;
  kind: string;
  status: string;
  gateway: string | null;
  createdAt: string;
  processedAt: string | null;
  amountSet: MoneyBag;
}

export interface ShopifyRefundNode {
  id: string;
  createdAt: string;
  processedAt: string;
  totalRefundedSet: MoneyBag;
  transactions: { nodes: ShopifyOrderTransactionNode[] };
}

export interface ShopifyFinanceOrderNode {
  id: string;
  updatedAt: string;
  transactions: { nodes: ShopifyOrderTransactionNode[] };
  refunds: ShopifyRefundNode[];
}

export interface ShopifyFinanceOrdersResponse {
  orders: {
    nodes: ShopifyFinanceOrderNode[];
    pageInfo: PageInfo;
  };
}

// ─── Shop Info ────────────────────────────────────────────────────────────

export interface ShopifyShopInfo {
  id: string;
  name: string;
  myshopifyDomain: string;
  email: string;
  currencyCode: string;
  primaryDomain: { url: string; host: string };
}

// ─── Token Exchange ───────────────────────────────────────────────────────

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

// ─── GraphQL Error Response ───────────────────────────────────────────────

export interface ShopifyGraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
  extensions?: Record<string, unknown>;
}

export interface ShopifyGraphQLResponse<T> {
  data?: T;
  errors?: ShopifyGraphQLError[];
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}
