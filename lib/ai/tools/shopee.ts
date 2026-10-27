/**
 * Read-only Shopee tools (Prisma-backed — operates on synced Shopee data,
 * not live Shopee API calls). Mirrors the aggregation patterns from
 * app/api/shopee/stats/route.ts and orders/near-sla/route.ts.
 *
 * All queries are scoped to the authenticated user via ShopeeShop.userId /
 * ShopeeOrder.userId / ShopeeProduct.userId — mirroring the auth pattern used
 * in the shopee API routes.
 */

import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import type { ChatTool, ToolSession } from "./types";
import { legacyShopeeOutstandingStatuses } from "@/lib/marketplace/sla/domain";

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

/** Resolve all ShopeeShop DB ids owned by the user (optionally filter by Shopee shopId). */
async function resolveShopIds(
  session: ToolSession,
  shopeeShopId?: number,
): Promise<string[]> {
  const where: Record<string, unknown> = { userId: session.id };
  if (typeof shopeeShopId === "number") where.shopId = shopeeShopId;
  const shops = await prisma.shopeeShop.findMany({
    where,
    select: { id: true, shopId: true, shopName: true, region: true },
  });
  return shops.map((s) => s.id);
}

/** getShopeeSummary — totals + breakdown by status (mirrors /api/shopee/stats). */
const getShopeeSummary: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getShopeeSummary",
      description:
        "Aggregate stats for the user's synced Shopee data: total products, total orders, total revenue, average order value, orders grouped by status, top 10 products by revenue, last sync time. Operates on locally-synced data — does not call Shopee API live.",
      parameters: {
        type: "object",
        properties: {
          shopId: {
            type: "integer",
            description: "Optional Shopee shop id to scope the aggregation.",
          },
        },
      },
    },
  },
  handler: async (args, session) => {
    const shopeeShopId =
      typeof args.shopId === "number"
        ? args.shopId
        : typeof args.shopId === "string" && args.shopId.trim()
          ? Number(args.shopId)
          : undefined;
    const cacheKey = `chat:shopeeSummary:${session.id}:${shopeeShopId ?? "all"}`;
    const data = await cached(cacheKey, 90, async () => {
      const shopIds = await resolveShopIds(session, shopeeShopId);
      if (shopIds.length === 0) {
        return {
          totalProducts: 0,
          totalOrders: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          ordersByStatus: {},
          topProducts: [],
          lastSyncedAt: null,
        };
      }
      const orderWhere = { shopId: { in: shopIds } };
      const [
        totalProducts,
        totalOrders,
        ordersByStatus,
        revenueAgg,
        topProductsRaw,
        lastShop,
      ] = await Promise.all([
        prisma.shopeeProduct.count({ where: { shopId: { in: shopIds } } }),
        prisma.shopeeOrder.count({ where: orderWhere }),
        prisma.shopeeOrder.groupBy({
          by: ["orderStatus"],
          where: orderWhere,
          _count: true,
        }),
        prisma.shopeeOrder.aggregate({
          where: orderWhere,
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
        }),
        prisma.shopeeOrderItem.groupBy({
          by: ["productName"],
          where: { order: { shopId: { in: shopIds } } },
          _sum: { subtotal: true, quantity: true },
          orderBy: { _sum: { subtotal: "desc" } },
          take: 10,
        }),
        prisma.shopeeShop.findFirst({
          where: { id: { in: shopIds } },
          orderBy: { lastSyncedAt: "desc" },
          select: { lastSyncedAt: true },
        }),
      ]);
      const statusMap: Record<string, number> = {};
      for (const s of ordersByStatus) statusMap[s.orderStatus] = s._count;
      return {
        totalProducts,
        totalOrders,
        totalRevenue: revenueAgg._sum.totalAmount ?? 0,
        averageOrderValue: revenueAgg._avg.totalAmount ?? 0,
        ordersByStatus: statusMap,
        topProducts: topProductsRaw.map((it) => ({
          name: it.productName,
          revenue: it._sum.subtotal ?? 0,
          quantity: Number(it._sum.quantity ?? 0),
        })),
        lastSyncedAt: lastShop?.lastSyncedAt?.toISOString() ?? null,
      };
    });
    return { ok: true, data };
  },
};

/** getShopeeNearSlaOrders — orders approaching their ship-by deadline. */
const getShopeeNearSlaOrders: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getShopeeNearSlaOrders",
      description:
        "List known stored Shopee ship-by deadlines within the next N hours (default 24), including overdue orders. This legacy order-level view has unverified coverage; a zero result is not a confirmed all-clear. Use the canonical marketplace SLA report for fresh package-level coverage.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 168, default: 24 },
          shopId: { type: "integer", description: "Optional Shopee shop id." },
        },
      },
    },
  },
  handler: async (args, session) => {
    const hours = Math.min(Math.max(Number(args.hours ?? 24), 1), 168);
    const shopeeShopId =
      typeof args.shopId === "number"
        ? args.shopId
        : typeof args.shopId === "string" && args.shopId.trim()
          ? Number(args.shopId)
          : undefined;
    const cacheKey = `chat:shopeeNearSla:v2:${session.id}:${shopeeShopId ?? "all"}:${hours}`;
    const data = await cached(cacheKey, 60, async () => {
      const shopIds = await resolveShopIds(session, shopeeShopId);
      if (shopIds.length === 0) return { total: 0, thresholdHours: hours, orders: [], coverage: { state: "unverified", countsAreConfirmed: false } };
      const now = new Date();
      const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const orders = await prisma.shopeeOrder.findMany({
        where: {
          shopId: { in: shopIds },
          orderStatus: { in: legacyShopeeOutstandingStatuses },
          shipByDate: { not: null, lte: deadline },
        },
        orderBy: { shipByDate: "asc" },
        select: {
          id: true,
          shopeeOrderId: true,
          orderStatus: true,
          shipByDate: true,
          totalAmount: true,
          buyerUsername: true,
          packageNumber: true,
          fulfillmentStatus: true,
          daysToShip: true,
        },
      });
      return {
        total: orders.length,
        thresholdHours: hours,
        coverage: { state: "unverified", countsAreConfirmed: false },
        warnings: ["Known stored deadlines only. Missing/stale observations cannot establish zero due orders."],
        orders: orders.map((o) => {
          const msRemaining = (o.shipByDate?.getTime() ?? 0) - now.getTime();
          const hoursRemaining =
            Math.round((msRemaining / (1000 * 60 * 60)) * 100) / 100;
          let urgency: "critical" | "high" | "medium";
          if (hoursRemaining < 6) urgency = "critical";
          else if (hoursRemaining < 12) urgency = "high";
          else urgency = "medium";
          return {
            id: o.id,
            orderId: o.shopeeOrderId,
            orderStatus: o.orderStatus,
            shipByDate: o.shipByDate?.toISOString() ?? null,
            hoursRemaining,
            urgency,
            buyerUsername: o.buyerUsername,
            totalAmount: o.totalAmount,
            packageNumber: o.packageNumber,
            fulfillmentStatus: o.fulfillmentStatus,
            daysToShip: o.daysToShip,
          };
        }),
      };
    });
    return { ok: true, data };
  },
};

/** getShopeeRecentOrders — recent Shopee orders (synced locally). */
const getShopeeRecentOrders: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getShopeeRecentOrders",
      description:
        "List recent Shopee orders (synced locally). Returns order id, shopee order id, status, total, buyer username, ship-by date and items.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          shopId: { type: "integer", description: "Optional Shopee shop id." },
        },
      },
    },
  },
  handler: async (args, session) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
    const shopeeShopId =
      typeof args.shopId === "number"
        ? args.shopId
        : typeof args.shopId === "string" && args.shopId.trim()
          ? Number(args.shopId)
          : undefined;
    const cacheKey = `chat:shopeeRecentOrders:${session.id}:${shopeeShopId ?? "all"}:${limit}`;
    const data = await cached(cacheKey, 60, async () => {
      const shopIds = await resolveShopIds(session, shopeeShopId);
      if (shopIds.length === 0) return { count: 0, orders: [] };
      const orders = await prisma.shopeeOrder.findMany({
        where: { shopId: { in: shopIds } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          shopeeOrderId: true,
          orderStatus: true,
          paymentStatus: true,
          totalAmount: true,
          currency: true,
          buyerUsername: true,
          shipByDate: true,
          createdAt: true,
          items: { select: { productName: true, quantity: true, price: true } },
        },
      });
      return {
        count: orders.length,
        orders: orders.map((o) => ({
          id: o.id,
          orderId: o.shopeeOrderId,
          orderStatus: o.orderStatus,
          paymentStatus: o.paymentStatus,
          totalAmount: o.totalAmount,
          currency: o.currency,
          buyerUsername: o.buyerUsername,
          shipByDate: o.shipByDate?.toISOString() ?? null,
          createdAt: o.createdAt.toISOString(),
          items: o.items.map((it) => ({
            productName: it.productName,
            quantity: Number(it.quantity),
            price: it.price,
          })),
        })),
      };
    });
    return { ok: true, data };
  },
};

/** getShopeeProducts — synced Shopee products (optionally low-stock only). */
const getShopeeProducts: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getShopeeProducts",
      description:
        "List Shopee products synced locally for the user. Optionally filter by variant/parent SKU, low-stock items, or shop. Returns variant details (modelSku, modelName, stock per variant) when available.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          lowStockThreshold: {
            type: "integer",
            minimum: 0,
            description: "If set, only return products with stock <= this value.",
          },
          shopId: { type: "integer", description: "Optional Shopee shop id." },
          sku: {
            type: "string",
            description:
              "Filter by SKU. Matches against parent item SKU (itemSku) or any variant SKU (modelSku).",
          },
        },
      },
    },
  },
  handler: async (args, session) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
    const lowStockThreshold =
      typeof args.lowStockThreshold === "number"
        ? Math.max(Number(args.lowStockThreshold), 0)
        : undefined;
    const shopeeShopId =
      typeof args.shopId === "number"
        ? args.shopId
        : typeof args.shopId === "string" && args.shopId.trim()
          ? Number(args.shopId)
          : undefined;
    const skuFilter =
      typeof args.sku === "string" && args.sku.trim()
        ? args.sku.trim()
        : undefined;
    const cacheKey = `chat:shopeeProducts:${session.id}:${shopeeShopId ?? "all"}:${limit}:${lowStockThreshold ?? "all"}:${skuFilter ?? "all"}`;
    const data = await cached(cacheKey, 60, async () => {
      const shopIds = await resolveShopIds(session, shopeeShopId);
      if (shopIds.length === 0) return { count: 0, products: [] };

      const where: Record<string, unknown> = { shopId: { in: shopIds } };
      if (skuFilter) {
        where.OR = [
          { itemSku: skuFilter },
          { variants: { some: { modelSku: skuFilter } } },
        ];
      }

      const products = await prisma.shopeeProduct.findMany({
        where,
        orderBy: { stock: "asc" },
        take: limit,
        select: {
          id: true,
          shopeeItemId: true,
          itemName: true,
          itemSku: true,
          price: true,
          stock: true,
          status: true,
          imageUrl: true,
          lastSyncedAt: true,
          variants: {
            select: {
              modelId: true,
              modelName: true,
              modelSku: true,
              price: true,
              stock: true,
              status: true,
            },
            orderBy: { stock: "asc" },
          },
        },
      });
      const filtered = lowStockThreshold
        ? products.filter((p) => p.stock <= lowStockThreshold)
        : products;
      return {
        count: filtered.length,
        products: filtered.map((p) => ({
          id: p.id,
          shopeeItemId: p.shopeeItemId,
          name: p.itemName,
          itemSku: p.itemSku,
          price: p.price,
          stock: p.stock,
          status: p.status,
          imageUrl: p.imageUrl,
          lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
          variants: p.variants.map((v) => ({
            modelId: v.modelId,
            modelName: v.modelName,
            modelSku: v.modelSku,
            price: v.price,
            stock: v.stock,
            status: v.status,
          })),
        })),
      };
    });
    return { ok: true, data };
  },
};

/** listShopeeShops — the user's connected Shopee shops. */
const listShopeeShops: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "listShopeeShops",
      description:
        "List Shopee shops connected by the user. Returns shopId (Shopee id), shopName, region, status and lastSyncedAt.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, session) => {
    const cacheKey = `chat:shopeeShops:${session.id}`;
    const data = await cached(cacheKey, 300, async () => {
      const shops = await prisma.shopeeShop.findMany({
        where: { userId: session.id },
        orderBy: { shopName: "asc" },
        select: {
          id: true,
          shopId: true,
          shopName: true,
          region: true,
          shopStatus: true,
          lastSyncedAt: true,
        },
      });
      return shops.map((s) => ({
        id: s.id,
        shopId: s.shopId,
        shopName: s.shopName,
        region: s.region,
        shopStatus: s.shopStatus,
        lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      }));
    });
    return { ok: true, data: { count: data.length, shops: data } };
  },
};

/** getShopeeSyncStatus — recent sync logs for the user's shops. */
const getShopeeSyncStatus: ChatTool = {
  definition: {
    type: "function",
    function: {
      name: "getShopeeSyncStatus",
      description:
        "Show the most recent Shopee sync logs for the user (status, type, items synced, errors, started/completed timestamps). Useful for diagnosing sync issues.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
        },
      },
    },
  },
  handler: async (args, session) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);
    const cacheKey = `chat:shopeeSyncStatus:${session.id}:${limit}`;
    const data = await cached(cacheKey, 60, async () => {
      const logs = await prisma.shopeeSyncLog.findMany({
        where: { userId: session.id },
        orderBy: { startedAt: "desc" },
        take: limit,
        select: {
          id: true,
          syncType: true,
          status: true,
          itemsSynced: true,
          itemsCreated: true,
          itemsUpdated: true,
          errors: true,
          startedAt: true,
          completedAt: true,
          triggeredBy: true,
        },
      });
      return logs.map((l) => ({
        id: l.id,
        syncType: l.syncType,
        status: l.status,
        itemsSynced: l.itemsSynced,
        itemsCreated: l.itemsCreated,
        itemsUpdated: l.itemsUpdated,
        errors: l.errors,
        startedAt: l.startedAt.toISOString(),
        completedAt: l.completedAt?.toISOString() ?? null,
        triggeredBy: l.triggeredBy,
      }));
    });
    return { ok: true, data: { count: data.length, logs: data } };
  },
};

export const shopeeTools: ChatTool[] = [
  getShopeeSummary,
  getShopeeNearSlaOrders,
  getShopeeRecentOrders,
  getShopeeProducts,
  listShopeeShops,
  getShopeeSyncStatus,
];
