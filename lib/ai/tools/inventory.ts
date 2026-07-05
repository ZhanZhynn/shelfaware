/**
 * Read-only inventory tools (Prisma-backed).
 *
 * All queries are scoped to the authenticated user (session.id), matching the
 * `userId`/`mergeProductListWhere` patterns used by app/api/products/route.ts.
 * None of these handlers mutate any data.
 */

import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import type { ChatTool } from "./types";

/** Small cached Prisma projection — keeps token cost down when the model re-asks. */
async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const cachedValue = await getCache<T>(key);
  if (cachedValue) return cachedValue;
  const value = await compute();
  await setCache(key, value, ttlSeconds).catch(() => {});
  return value;
}

/** Map a Prisma product row into the JSON-serialisable projection we hand back. */
function projectProduct(p: {
  id: string;
  name: string;
  sku: string;
  price: number | { toString(): string };
  quantity: bigint | { toString(): string };
  status: string;
  categoryId: string;
  supplierId: string;
  expirationDate: Date | null;
  updatedAt: Date | null;
}) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: typeof p.price === "number" ? p.price : Number(p.price),
    quantity:
      typeof p.quantity === "bigint" ? Number(p.quantity) : Number(p.quantity),
    status: p.status,
    categoryId: p.categoryId,
    supplierId: p.supplierId,
    expirationDate: p.expirationDate?.toISOString() ?? null,
    updatedAt: p.updatedAt?.toISOString() ?? null,
  };
}

/** listProducts — paginated list of products for the user. */
const listProducts: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "listProducts",
      description:
        "List products in the user's inventory. Returns id, name, sku, price, quantity, status, categoryId, supplierId. Paginate with limit/offset.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
          status: {
            type: "string",
            description: "Filter by product status if known (e.g. in-stock).",
          },
        },
      },
    },
  },
  handler: async (args, session) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    const status = typeof args.status === "string" ? args.status : undefined;
    const cacheKey = `chat:listProducts:${session.id}:${limit}:${offset}:${status ?? "all"}`;
    const data = await cached(cacheKey, 60, async () => {
      const products = await prisma.product.findMany({
        where: {
          userId: session.id,
          deletedAt: null,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          quantity: true,
          status: true,
          categoryId: true,
          supplierId: true,
          expirationDate: true,
          updatedAt: true,
        },
      });
      return products.map(projectProduct);
    });
    return { ok: true, data: { count: data.length, limit, offset, products: data } };
  },
};

/** getProductBySku — single product lookup by its unique SKU. */
const getProductBySku: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getProductBySku",
      description:
        "Fetch a single product by its SKU. Returns full product details if found.",
      parameters: {
        type: "object",
        properties: { sku: { type: "string" } },
        required: ["sku"],
      },
    },
  },
  handler: async (args, session) => {
    const sku = typeof args.sku === "string" ? args.sku.trim() : "";
    if (!sku) return { ok: false, error: "sku is required" };
    const product = await prisma.product.findUnique({
      where: { sku },
    });
    if (!product || product.userId !== session.id || product.deletedAt) {
      return { ok: false, error: `No product found with SKU "${sku}"` };
    }
    return { ok: true, data: projectProduct(product) };
  },
};

/** getLowStockProducts — products whose on-hand quantity is at or below a threshold. */
const getLowStockProducts: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getLowStockProducts",
      description:
        "List products whose on-hand quantity is at or below a given threshold (defaults to 10). Useful for reorder decisions.",
      parameters: {
        type: "object",
        properties: {
          threshold: { type: "integer", minimum: 0, default: 10 },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
        },
      },
    },
  },
  handler: async (args, session) => {
    const threshold = Math.max(Number(args.threshold ?? 10), 0);
    const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
    const cacheKey = `chat:lowStock:${session.id}:${threshold}:${limit}`;
    const data = await cached(cacheKey, 60, async () => {
      const products = await prisma.product.findMany({
        where: { userId: session.id, deletedAt: null },
        orderBy: { quantity: "asc" },
        take: limit,
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          quantity: true,
          status: true,
          categoryId: true,
          supplierId: true,
          expirationDate: true,
          updatedAt: true,
        },
      });
      // BigInt comparison is fine in JS — filter to those <= threshold.
      return products
        .filter((p) => Number(p.quantity) <= threshold)
        .map(projectProduct);
    });
    return { ok: true, data: { threshold, count: data.length, products: data } };
  },
};

/** getInventorySummary — high-level counts: total SKUs, total units, value, by status. */
const getInventorySummary: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getInventorySummary",
      description:
        "Return an inventory summary for the user: total SKU count, total units on hand, total stock value, and a breakdown by status.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, session) => {
    const cacheKey = `chat:invSummary:${session.id}`;
    const data = await cached(cacheKey, 90, async () => {
      const products = await prisma.product.findMany({
        where: { userId: session.id, deletedAt: null },
        select: { quantity: true, price: true, status: true },
      });
      const totalSkus = products.length;
      let totalUnits = 0;
      let totalValue = 0;
      const byStatus: Record<string, number> = {};
      for (const p of products) {
        const qty = Number(p.quantity);
        totalUnits += qty;
        totalValue += qty * Number(p.price);
        byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      }
      return {
        totalSkus,
        totalUnits,
        totalStockValue: Math.round(totalValue * 100) / 100,
        byStatus,
      };
    });
    return { ok: true, data };
  },
};

/** listCategories — categories owned by the user. */
const listCategories: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "listCategories",
      description: "List product categories for the authenticated user.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, session) => {
    const cacheKey = `chat:categories:${session.id}`;
    const data = await cached(cacheKey, 300, async () => {
      const categories = await prisma.category.findMany({
        where: { userId: session.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, createdAt: true },
      });
      return categories.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.createdAt.toISOString(),
      }));
    });
    return { ok: true, data: { count: data.length, categories: data } };
  },
};

/** listSuppliers — suppliers owned by the user. */
const listSuppliers: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "listSuppliers",
      description: "List suppliers for the authenticated user.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, session) => {
    const cacheKey = `chat:suppliers:${session.id}`;
    const data = await cached(cacheKey, 300, async () => {
      const suppliers = await prisma.supplier.findMany({
        where: { userId: session.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, createdAt: true },
      });
      return suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt.toISOString(),
      }));
    });
    return { ok: true, data: { count: data.length, suppliers: data } };
  },
};

/** listWarehouses — warehouses owned by the user. */
const listWarehouses: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "listWarehouses",
      description: "List warehouses for the authenticated user.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, session) => {
    const cacheKey = `chat:warehouses:${session.id}`;
    const data = await cached(cacheKey, 300, async () => {
      const warehouses = await prisma.warehouse.findMany({
        where: { userId: session.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, address: true, type: true, createdAt: true },
      });
      return warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        address: w.address,
        type: w.type,
        createdAt: w.createdAt.toISOString(),
      }));
    });
    return { ok: true, data: { count: data.length, warehouses: data } };
  },
};

/** getRecentOrders — recent customer orders for the user (mirrors admin orders route). */
const getRecentOrders: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getRecentOrders",
      description:
        "List recent customer orders for the user. Returns id, orderNumber, status, total, createdAt, paymentStatus and items.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
  },
  handler: async (args, session) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
    const cacheKey = `chat:recentOrders:${session.id}:${limit}`;
    const data = await cached(cacheKey, 60, async () => {
      const orders = await prisma.order.findMany({
        where: { userId: session.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          paymentStatus: true,
          createdAt: true,
          items: { select: { productName: true, quantity: true } },
        },
      });
      return orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt.toISOString(),
        items: o.items.map((it) => ({
          productName: it.productName,
          quantity: Number(it.quantity),
        })),
      }));
    });
    return { ok: true, data: { count: data.length, orders: data } };
  },
};

export const inventoryTools: ChatTool[] = [
  listProducts,
  getProductBySku,
  getLowStockProducts,
  getInventorySummary,
  listCategories,
  listSuppliers,
  listWarehouses,
  getRecentOrders,
];