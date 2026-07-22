import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above imports and cannot reference outer
// variables directly — use vi.hoisted() to declare the mock objects.
const { prismaMock, getCache, setCache } = vi.hoisted(() => {
  const prismaMock = {
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    category: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    warehouse: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
  };
  return {
    prismaMock,
    getCache: vi.fn(),
    setCache: vi.fn(),
  };
});

// Handlers import { prisma } from "@/prisma/client" and
// { getCache, setCache } from "@/lib/cache/cache-utils".
vi.mock("@/prisma/client", () => ({ prisma: prismaMock }));
vi.mock("@/lib/cache/cache-utils", () => ({ getCache, setCache }));

import { __handlersForTests } from "./registry";
import { inventoryTools } from "./inventory";
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
  prismaMock.product.findMany.mockReset();
  prismaMock.product.findFirst.mockReset();
  prismaMock.product.findUnique.mockReset();
  prismaMock.category.findMany.mockReset();
  prismaMock.supplier.findMany.mockReset();
  prismaMock.warehouse.findMany.mockReset();
  prismaMock.order.findMany.mockReset();
  getCache.mockReset();
  getCache.mockResolvedValue(null);
  setCache.mockReset();
  setCache.mockResolvedValue(true);
});

describe("inventoryTools export", () => {
  it("registers 8 tools", () => {
    expect(inventoryTools).toHaveLength(8);
  });
});

describe("listProducts handler", () => {
  it("queries products scoped to the user and projects BigInts", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "Widget",
        sku: "W-1",
        price: 9.99,
        quantity: BigInt(5),
        status: "in-stock",
        categoryId: "c1",
        supplierId: "s1",
        expirationDate: null,
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);
    const result = await getHandler("listProducts")({ limit: 5 }, session);
    expect(result.ok).toBe(true);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      skip: 0,
      select: expect.objectContaining({ id: true, sku: true, quantity: true }),
    });
    expect(result.data).toMatchObject({
      count: 1,
      products: [{ sku: "W-1", quantity: 5, price: 9.99 }],
    });
  });

  it("applies a status filter when provided", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await getHandler("listProducts")({ status: "in-stock" }, session);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", deletedAt: null, status: "in-stock" } }),
    );
  });

  it("clamps limit to [1, 50]", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await getHandler("listProducts")({ limit: 1000 }, session);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});

describe("getProductBySku handler", () => {
  it("returns the product when it belongs to the user and is not deleted", async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: "p1",
      name: "Widget",
      sku: "W-1",
      price: 19.5,
      quantity: BigInt(3),
      status: "in-stock",
      categoryId: "c1",
      supplierId: "s1",
      expirationDate: null,
      updatedAt: null,
      userId: "user-1",
      deletedAt: null,
    });
    const result = await getHandler("getProductBySku")({ sku: "W-1" }, session);
    expect(result.ok).toBe(true);
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({ where: { sku: "W-1", userId: "user-1" } });
    expect(result.data).toMatchObject({ sku: "W-1", quantity: 3 });
  });

  it("errors when product missing", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const result = await getHandler("getProductBySku")({ sku: "NOPE" }, session);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No product found/);
  });

  it("errors when product belongs to a different user", async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: "p2",
      name: "X",
      sku: "W-2",
      price: 1,
      quantity: BigInt(0),
      status: "in-stock",
      categoryId: "c",
      supplierId: "s",
      expirationDate: null,
      updatedAt: null,
      userId: "other-user",
      deletedAt: null,
    });
    const result = await getHandler("getProductBySku")({ sku: "W-2" }, session);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No product found/);
  });

  it("errors when sku is empty", async () => {
    const result = await getHandler("getProductBySku")({ sku: "  " }, session);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sku is required/);
    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
  });
});

describe("getLowStockProducts handler", () => {
  it("filters products whose quantity is <= threshold", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "Low",
        sku: "L",
        price: 1,
        quantity: BigInt(2),
        status: "in-stock",
        categoryId: "c",
        supplierId: "s",
        expirationDate: null,
        updatedAt: null,
      },
      {
        id: "p2",
        name: "High",
        sku: "H",
        price: 1,
        quantity: BigInt(50),
        status: "in-stock",
        categoryId: "c",
        supplierId: "s",
        expirationDate: null,
        updatedAt: null,
      },
    ]);
    const result = await getHandler("getLowStockProducts")({ threshold: 10 }, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ threshold: 10, count: 1 });
    expect((result.data as { products: { sku: string }[] }).products).toHaveLength(1);
  });
});

describe("getInventorySummary handler", () => {
  it("aggregates totals and groups by status", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { quantity: BigInt(10), price: 5, status: "in-stock" },
      { quantity: BigInt(2), price: 20, status: "low-stock" },
    ]);
    const result = await getHandler("getInventorySummary")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      totalSkus: 2,
      totalUnits: 12,
      totalStockValue: 90, // 10*5 + 2*20
      byStatus: { "in-stock": 1, "low-stock": 1 },
    });
  });
});

describe("listCategories handler", () => {
  it("returns categories for the user", async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: "c1", name: "Tools", createdAt: new Date("2024-01-01T00:00:00Z") },
    ]);
    const result = await getHandler("listCategories")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ count: 1, categories: [{ name: "Tools" }] });
  });
});

describe("listSuppliers handler", () => {
  it("returns suppliers for the user", async () => {
    prismaMock.supplier.findMany.mockResolvedValue([
      { id: "s1", name: "Acme", createdAt: new Date("2024-01-01T00:00:00Z") },
    ]);
    const result = await getHandler("listSuppliers")({}, session);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ count: 1, suppliers: [{ name: "Acme" }] });
  });
});

describe("listWarehouses handler", () => {
  it("returns warehouses with address (not location)", async () => {
    prismaMock.warehouse.findMany.mockResolvedValue([
      {
        id: "w1",
        name: "Main",
        address: "123 Depot Rd",
        type: "central",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);
    const result = await getHandler("listWarehouses")({}, session);
    expect(result.ok).toBe(true);
    expect(prismaMock.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ address: true }),
      }),
    );
    expect(result.data).toMatchObject({
      warehouses: [{ name: "Main", address: "123 Depot Rd" }],
    });
  });
});

describe("getRecentOrders handler", () => {
  it("returns recent orders with their items (relation is `items`)", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "o1",
        orderNumber: "ORD-1",
        status: "pending",
        total: 25.5,
        paymentStatus: "unpaid",
        createdAt: new Date("2024-02-01T00:00:00Z"),
        items: [{ productName: "Widget", quantity: 2 }],
      },
    ]);
    const result = await getHandler("getRecentOrders")({ limit: 1 }, session);
    expect(result.ok).toBe(true);
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        select: expect.objectContaining({
          total: true,
          items: { select: { productName: true, quantity: true } },
        }),
      }),
    );
    expect(result.data).toMatchObject({
      orders: [{ orderNumber: "ORD-1", total: 25.5, items: [{ productName: "Widget", quantity: 2 }] }],
    });
  });
});
