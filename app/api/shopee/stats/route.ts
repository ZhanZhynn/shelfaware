/**
 * Shopee Stats — Aggregated Statistics
 * GET /api/shopee/stats
 * Query params: shopId, dateFrom, dateTo (ISO date strings, e.g. 2026-06-01)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get("shopId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Build date filter for order queries
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom);
    }
    if (dateTo) {
      // Include the entire "to" day
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }

    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const dateRangeKey = hasDateFilter
      ? `${dateFrom || ""}_${dateTo || ""}`
      : undefined;

    const cacheKey = cacheKeys.shopee.stats(shopId || "all", dateRangeKey);
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = Number(shopId);

    // Get shop IDs for this user
    const shops = await prisma.shopeeShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      const emptyStats = {
        totalProducts: 0,
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        ordersByStatus: {} as Record<string, number>,
        topProducts: [] as { name: string; revenue: number; quantity: number }[],
        lastSyncedAt: null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      };
      return NextResponse.json(emptyStats);
    }

    // Base order filter (shop + optional date range on Shopee order date)
    const orderWhere: Record<string, unknown> = { shopId: { in: shopIds } };
    if (hasDateFilter) {
      orderWhere.shopeeCreatedAt = dateFilter;
    }

    // For top products, we need to filter orders by date then join items
    const orderItemWhere: Record<string, unknown> = {
      order: { shopId: { in: shopIds } },
    };
    if (hasDateFilter) {
      orderItemWhere.order = {
        shopId: { in: shopIds },
        shopeeCreatedAt: dateFilter,
      };
    }

    // Aggregate in parallel
    const [totalProducts, totalOrders, ordersByStatus, recentOrderStats] =
      await Promise.all([
        prisma.shopeeProduct.count({
          where: { shopId: { in: shopIds } },
        }),
        prisma.shopeeOrder.count({
          where: orderWhere,
        }),
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
      ]);

    // Get top products by revenue using DB aggregation (not in-memory)
    const topProductsRaw = await prisma.shopeeOrderItem.groupBy({
      by: ["productName"],
      where: orderItemWhere,
      _sum: { subtotal: true, quantity: true },
      orderBy: { _sum: { subtotal: "desc" } },
      take: 10,
    });

    const topProducts = topProductsRaw.map((item) => ({
      name: item.productName,
      revenue: item._sum.subtotal || 0,
      quantity: Number(item._sum.quantity || 0),
    }));

    // Get last sync time
    const lastShop = await prisma.shopeeShop.findFirst({
      where: { id: { in: shopIds } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    });

    const statusMap: Record<string, number> = {};
    for (const s of ordersByStatus) {
      statusMap[s.orderStatus] = s._count;
    }

    const stats = {
      totalProducts,
      totalOrders,
      totalRevenue: recentOrderStats._sum.totalAmount || 0,
      averageOrderValue: recentOrderStats._avg.totalAmount || 0,
      ordersByStatus: statusMap,
      topProducts,
      lastSyncedAt: lastShop?.lastSyncedAt || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    };

    await setCache(cacheKey, stats, 120);

    return NextResponse.json(stats);
  } catch (error) {
    logger.error("[Shopee Stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
