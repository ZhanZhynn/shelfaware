import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, getCache, setCache } = vi.hoisted(() => {
  const prismaMock = {
    shopeeShop: { findMany: vi.fn(), findFirst: vi.fn() },
    shopeeProduct: { findMany: vi.fn(), count: vi.fn() },
    shopeeOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    shopeeOrderItem: { groupBy: vi.fn() },
    shopeeSyncLog: { findMany: vi.fn() },
  };
  return {
    prismaMock,
    getCache: vi.fn(),
    setCache: vi.fn(),
  };
});

vi.mock("@/prisma/client", () => ({ prisma: prismaMock }));
vi.mock("@/lib/cache/cache-utils", () => ({ getCache, setCache }));

import { __handlersForTests } from "./registry";
import { shopeeTools } from "./shopee";
import type { ToolSession } from "./types";

const session: ToolSession = {
  id: "user-1",
  role: "ADMIN" as never,
  name: "Admin",
  email: "admin@example.com",
};

function getHandler(name: string) {
  const h = __handlersForTests[name];
  if (!h) throw new Error(`No handler registered for "${name}"`);
  return h;
}

beforeEach(() => {
  for (const m of [
    prismaMock.shopeeShop.findMany,
    prismaMock.shopeeShop.findFirst,
    prismaMock.shopeeProduct.findMany,
    prismaMock.shopeeProduct.count,
    prismaMock.shopeeOrder.findMany,
    prismaMock.shopeeOrder.count,
    prismaMock.shopeeOrder.groupBy,
    prismaMock.shopeeOrder.aggregate,
    prismaMock.shopeeOrderItem.groupBy,
    prismaMock.shopeeSyncLog.findMany,
  ]) {
    m.mockReset();
  }
  getCache.mockReset();
  getCache.mockResolvedValue(null);
  setCache.mockReset();
  setCache.mockResolvedValue(true);
});

describe("shopeeTools export", () => {
  it("registers 6 tools", () => {
    expect(shopeeTools).toHaveLength(6);
  });
});

describe("getShopeeSummary handler", () => {
  it("returns zeroed summary when user has no shops", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([]);
    const result = await getHandler("getShopeeSummary")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      totalProducts: 0,
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      ordersByStatus: {},
      topProducts: [],
      lastSyncedAt: null,
    });
    expect(prismaMock.shopeeProduct.count).not.toHaveBeenCalled();
  });

  it("aggregates totals when shops exist", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    prismaMock.shopeeProduct.count.mockResolvedValue(12);
    prismaMock.shopeeOrder.count.mockResolvedValue(8);
    prismaMock.shopeeOrder.groupBy.mockResolvedValue([
      { orderStatus: "completed", _count: 5 },
      { orderStatus: "processing", _count: 3 },
    ]);
    prismaMock.shopeeOrder.aggregate.mockResolvedValue({
      _sum: { totalAmount: 1000 },
      _avg: { totalAmount: 125 },
    });
    prismaMock.shopeeOrderItem.groupBy.mockResolvedValue([
      { productName: "Item A", _sum: { subtotal: 500, quantity: 10 } },
    ]);
    prismaMock.shopeeShop.findFirst.mockResolvedValue({
      lastSyncedAt: new Date("2024-03-01T00:00:00Z"),
    });
    const result = await getHandler("getShopeeSummary")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      totalProducts: 12,
      totalOrders: 8,
      totalRevenue: 1000,
      averageOrderValue: 125,
      ordersByStatus: { completed: 5, processing: 3 },
      topProducts: [{ name: "Item A", revenue: 500, quantity: 10 }],
      lastSyncedAt: "2024-03-01T00:00:00.000Z",
    });
  });
});

describe("getShopeeNearSlaOrders handler", () => {
  it("returns empty when user has no shops", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([]);
    const result = await getHandler("getShopeeNearSlaOrders")({ hours: 24 }, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ total: 0, thresholdHours: 24, orders: [] });
  });

  it("labels orders with the correct urgency bucket", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    const now = new Date();
    const critical = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const high = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const medium = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    prismaMock.shopeeOrder.findMany.mockResolvedValue([
      { id: "o1", shopeeOrderId: "S1", orderStatus: "confirmed", shipByDate: critical, totalAmount: 50, buyerUsername: "a", packageNumber: null, fulfillmentStatus: null, daysToShip: null },
      { id: "o2", shopeeOrderId: "S2", orderStatus: "processing", shipByDate: high, totalAmount: 30, buyerUsername: "b", packageNumber: null, fulfillmentStatus: null, daysToShip: null },
      { id: "o3", shopeeOrderId: "S3", orderStatus: "confirmed", shipByDate: medium, totalAmount: 10, buyerUsername: "c", packageNumber: null, fulfillmentStatus: null, daysToShip: null },
    ]);
    const result = await getHandler("getShopeeNearSlaOrders")({ hours: 24 }, session);
    expect(result.ok).toBe(true);
    const data = result.data as { orders: { urgency: string; orderId: string }[] };
    expect(data.orders).toHaveLength(3);
    expect(data.orders.map((o) => o.urgency)).toEqual(
      expect.arrayContaining(["critical", "high", "medium"]),
    );
  });

  it("clamps hours to [1, 168]", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    prismaMock.shopeeOrder.findMany.mockResolvedValue([]);
    await getHandler("getShopeeNearSlaOrders")({ hours: 9999 }, session);
    const where = prismaMock.shopeeOrder.findMany.mock.calls[0]?.[0]?.where as {
      shipByDate: { lte: Date };
    };
    expect(where).toBeDefined();
    expect(where.shipByDate.lte.getTime() - Date.now()).toBeLessThan(168 * 60 * 60 * 1000 + 1000);
  });
});

describe("getShopeeRecentOrders handler", () => {
  it("returns empty when user has no shops", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([]);
    const result = await getHandler("getShopeeRecentOrders")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ count: 0, orders: [] });
  });

  it("returns recent orders with their items", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    prismaMock.shopeeOrder.findMany.mockResolvedValue([
      {
        id: "o1",
        shopeeOrderId: "S1",
        orderStatus: "completed",
        paymentStatus: "paid",
        totalAmount: 100,
        currency: "SGD",
        buyerUsername: "alice",
        shipByDate: null,
        createdAt: new Date("2024-04-01T00:00:00Z"),
        items: [{ productName: "A", quantity: 2, price: 50 }],
      },
    ]);
    const result = await getHandler("getShopeeRecentOrders")({ limit: 5 }, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      count: 1,
      orders: [{ orderId: "S1", orderStatus: "completed", items: [{ productName: "A", quantity: 2 }] }],
    });
  });
});

describe("getShopeeProducts handler", () => {
  it("returns empty when user has no shops", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([]);
    const result = await getHandler("getShopeeProducts")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ count: 0, products: [] });
  });

  it("filters by lowStockThreshold when provided", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      { id: "p1", shopeeItemId: 1, itemName: "Low", price: 5, stock: 3, status: "active", imageUrl: null, lastSyncedAt: null },
      { id: "p2", shopeeItemId: 2, itemName: "Ok", price: 5, stock: 100, status: "active", imageUrl: null, lastSyncedAt: null },
    ]);
    const result = await getHandler("getShopeeProducts")({ lowStockThreshold: 10 }, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ count: 1 });
    expect((result.data as { products: { name: string }[] }).products[0].name).toBe("Low");
  });
});

describe("listShopeeShops handler", () => {
  it("returns the user's connected shops", async () => {
    prismaMock.shopeeShop.findMany.mockResolvedValue([
      {
        id: "shop-1",
        shopId: 12345,
        shopName: "Acme SG",
        region: "SG",
        shopStatus: "active",
        lastSyncedAt: new Date("2024-05-01T00:00:00Z"),
      },
    ]);
    const result = await getHandler("listShopeeShops")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      count: 1,
      shops: [{ shopId: 12345, shopName: "Acme SG", region: "SG" }],
    });
  });
});

describe("getShopeeSyncStatus handler", () => {
  it("returns recent sync logs", async () => {
    prismaMock.shopeeSyncLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        syncType: "orders",
        status: "success",
        itemsSynced: 10,
        itemsCreated: 2,
        itemsUpdated: 3,
        errors: null,
        startedAt: new Date("2024-06-01T00:00:00Z"),
        completedAt: new Date("2024-06-01T00:01:00Z"),
        triggeredBy: "manual",
      },
    ]);
    const result = await getHandler("getShopeeSyncStatus")({ limit: 5 }, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      count: 1,
      logs: [{ syncType: "orders", status: "success", triggeredBy: "manual" }],
    });
  });
});