/**
 * Server-side data fetching for combined WMS + Shopee orders.
 * Normalizes both sources into a unified shape for Business Insights charts.
 * Only import from server code.
 */

import { getCache, setCache, cacheKeys } from "@/lib/cache";
import { prisma } from "@/prisma/client";

/** Normalized order item shape */
export type CombinedOrderItem = {
  productName: string;
  quantity: number;
  price: number;
};

/** Normalized order shape — unified WMS + Shopee */
export type CombinedOrder = {
  id: string;
  source: "wms" | "shopee";
  total: number;
  status: string;
  createdAt: string;
  items: CombinedOrderItem[];
};

const CACHE_TTL = 300; // 5 minutes

/**
 * Fetch and normalize WMS + Shopee orders for the given user.
 * Two parallel Prisma queries, then merge into a unified shape.
 */
export async function getCombinedOrdersForUser(
  userId: string,
): Promise<CombinedOrder[]> {
  const cacheKey = cacheKeys.businessInsights.combinedOrders(userId);
  const cached = await getCache<CombinedOrder[]>(cacheKey);
  if (cached) return cached;

  // Get user's Shopee shop IDs
  const shopeeShops = await prisma.shopeeShop.findMany({
    where: { userId },
    select: { id: true },
  });
  const shopeeShopIds = shopeeShops.map((s) => s.id);

  // Run both queries in parallel
  const [wmsOrders, shopeeOrders] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        items: {
          select: {
            productName: true,
            quantity: true,
            price: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    shopeeShopIds.length > 0
      ? prisma.shopeeOrder.findMany({
          where: { shopId: { in: shopeeShopIds } },
          select: {
            id: true,
            orderStatus: true,
            totalAmount: true,
            shopeeCreatedAt: true,
            createdAt: true,
            items: {
              select: {
                productName: true,
                quantity: true,
                price: true,
              },
            },
          },
          orderBy: { shopeeCreatedAt: "desc" },
        })
      : [],
  ]);

  // Normalize and merge
  const combined: CombinedOrder[] = [
    ...wmsOrders.map((o) => ({
      id: o.id,
      source: "wms" as const,
      total: o.total,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
      })),
    })),
    ...shopeeOrders.map((o) => ({
      id: o.id,
      source: "shopee" as const,
      total: o.totalAmount,
      status: o.orderStatus,
      createdAt: (o.shopeeCreatedAt ?? o.createdAt).toISOString(),
      items: o.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
      })),
    })),
  ];

  // Sort by createdAt descending
  combined.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  await setCache(cacheKey, combined, CACHE_TTL);
  return combined;
}
