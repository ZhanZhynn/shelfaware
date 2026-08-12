import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchAllOrders } = vi.hoisted(() => {
  const tx = {
    shopifyOrder: { update: vi.fn(), create: vi.fn() },
    shopifyOrderItem: { deleteMany: vi.fn(), create: vi.fn() },
    shopifyProductVariant: { findFirst: vi.fn() },
  };
  const prismaMock = {
    shopifyShop: { findFirst: vi.fn(), update: vi.fn() },
    shopifyOrder: { findFirst: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (operation) => operation(tx)),
    tx,
  };
  return { prismaMock, fetchAllOrders: vi.fn() };
});

vi.mock("@/prisma/client", () => ({ default: prismaMock }));
vi.mock("./graphql-client", () => ({ fetchAllOrders, fetchAllProducts: vi.fn(), fetchAllFinanceOrders: vi.fn() }));
vi.mock("./server", () => ({ setActiveShop: vi.fn(), validateShopifyToken: vi.fn().mockResolvedValue({ valid: true }), getActiveAccessToken: vi.fn().mockResolvedValue("token"), SHOPIFY_API_VERSION: "2025-07" }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: vi.fn() }));

import { syncShopifyOrders } from "./sync";

const order = {
  id: "gid://shopify/Order/1", name: "#1", email: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", processedAt: "2026-01-01T00:00:00Z", closedAt: null, cancelledAt: null, cancelReason: null, closed: false, confirmed: true, test: false, note: null, tags: [], currencyCode: "USD", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", totalPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } }, subtotalPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } }, totalShippingPriceSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } }, totalTaxSet: null, customer: null, shippingAddress: null,
  lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", name: "Line", title: "Line", quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, sku: null, product: null, variant: null, originalUnitPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } }, discountedUnitPriceSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } }, discountedTotalSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } } }], pageInfo: { hasNextPage: false, endCursor: null } },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.shopifyShop.findFirst.mockResolvedValue({ id: "shop-record", shopDomain: "shop.myshopify.com" });
  prismaMock.shopifyShop.update.mockResolvedValue({});
  prismaMock.syncLog.create.mockResolvedValue({ id: "log" });
  prismaMock.syncLog.update.mockResolvedValue({});
  prismaMock.shopifyOrder.findFirst.mockResolvedValue({ id: "order-record" });
  prismaMock.tx.shopifyOrder.update.mockResolvedValue({ id: "order-record" });
  prismaMock.tx.shopifyOrderItem.deleteMany.mockResolvedValue({});
  prismaMock.tx.shopifyOrderItem.create.mockResolvedValue({});
  prismaMock.tx.shopifyProductVariant.findFirst.mockResolvedValue(null);
  fetchAllOrders.mockResolvedValue([order]);
});

describe("Shopify order persistence", () => {
  it("does not count or partially replace an order when an item write fails", async () => {
    prismaMock.tx.shopifyOrderItem.create.mockRejectedValueOnce(new Error("write failed"));

    const result = await syncShopifyOrders("shop-record", "user-record");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ synced: 0, created: 0, updated: 0 });
    expect(result.errors).toEqual([expect.stringContaining("write failed")]);
    // The real Mongo transaction rolls back the preceding order update and item delete.
    expect(prismaMock.tx.shopifyOrderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: "order-record" } });
  });

  it("preserves a prior complete snapshot when the refresh line items are incomplete", async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue({ id: "order-record", isLineItemsComplete: true, items: [] });
    fetchAllOrders.mockResolvedValue([{ ...order, lineItems: { ...order.lineItems, pageInfo: { hasNextPage: true, endCursor: "next" } }, lineItemsFetchError: "page failed" }]);

    const result = await syncShopifyOrders("shop-record", "user-record");

    expect(prismaMock.tx.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.tx.shopifyOrderItem.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.tx.shopifyOrderItem.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synced: 0, created: 0, updated: 0 });
    expect(result.errors).toEqual([expect.stringContaining("preserved prior complete snapshot")]);
  });

  it("preserves a legacy order and its items when the refresh line items are incomplete", async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue({
      id: "order-record",
      isLineItemsComplete: undefined,
      items: [{ id: "legacy-line-item" }],
    });
    fetchAllOrders.mockResolvedValue([{ ...order, name: "#1 changed", lineItems: { ...order.lineItems, pageInfo: { hasNextPage: true, endCursor: "next" } } }]);

    const result = await syncShopifyOrders("shop-record", "user-record");

    expect(prismaMock.tx.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.tx.shopifyOrderItem.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.tx.shopifyOrderItem.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synced: 0, created: 0, updated: 0 });
    expect(result.errors).toEqual([expect.stringContaining("preserved prior complete snapshot")]);
  });

  it("stores a first-seen incomplete order without partial line items", async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(null);
    prismaMock.tx.shopifyOrder.create.mockResolvedValue({ id: "order-record" });
    fetchAllOrders.mockResolvedValue([{ ...order, lineItems: { ...order.lineItems, pageInfo: { hasNextPage: true, endCursor: "next" } } }]);

    const result = await syncShopifyOrders("shop-record", "user-record");

    expect(prismaMock.tx.shopifyOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isLineItemsComplete: false }),
    }));
    expect(prismaMock.tx.shopifyOrderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: "order-record" } });
    expect(prismaMock.tx.shopifyOrderItem.create).not.toHaveBeenCalled();
    expect(result.errors).toEqual([expect.stringContaining("stored without line facts")]);
  });

  it("atomically replaces items after all paginated line items are complete", async () => {
    fetchAllOrders.mockResolvedValue([{ ...order, lineItems: { ...order.lineItems, nodes: [...order.lineItems.nodes, { ...order.lineItems.nodes[0], id: "gid://shopify/LineItem/2" }], pageInfo: { hasNextPage: false, endCursor: "final" } } }]);

    await syncShopifyOrders("shop-record", "user-record");

    expect(prismaMock.tx.shopifyOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-record" },
      data: expect.objectContaining({ isLineItemsComplete: true }),
    }));
    expect(prismaMock.tx.shopifyOrderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: "order-record" } });
    expect(prismaMock.tx.shopifyOrderItem.create).toHaveBeenCalledTimes(2);
  });
});
