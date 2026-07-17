/**
 * Shopify Stats — Aggregated Statistics
 * GET /api/shopify/stats
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

    const dateFilter: Record<string, Date> = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.lte = to;
    }

    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const dateRangeKey = hasDateFilter
      ? `${dateFrom || ""}_${dateTo || ""}`
      : undefined;

    const cacheKey = cacheKeys.shopify.stats(shopId || "all", dateRangeKey);
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.id = shopId;

    const shops = await prisma.shopifyShop.findMany({
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

    const orderWhere: Record<string, unknown> = { shopId: { in: shopIds } };
    if (hasDateFilter) {
      orderWhere.shopifyCreatedAt = dateFilter;
    }

    const orderItemWhere: Record<string, unknown> = {
      order: { shopId: { in: shopIds } },
    };
    if (hasDateFilter) {
      orderItemWhere.order = {
        shopId: { in: shopIds },
        shopifyCreatedAt: dateFilter,
      };
    }

    const [totalProducts, totalOrders, ordersByStatus, recentOrderStats] =
      await Promise.all([
        prisma.shopifyProduct.count({
          where: { shopId: { in: shopIds } },
        }),
        prisma.shopifyOrder.count({
          where: orderWhere,
        }),
        prisma.shopifyOrder.groupBy({
          by: ["orderStatus"],
          where: orderWhere,
          _count: true,
        }),
        prisma.shopifyOrder.aggregate({
          where: orderWhere,
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
        }),
      ]);

    const orderItems = await prisma.shopifyOrderItem.findMany({
      where: orderItemWhere,
      select: { name: true, price: true, quantity: true },
    });

    const productMap = new Map<string, { revenue: number; quantity: number }>();
    for (const item of orderItems) {
      const existing = productMap.get(item.name);
      const itemRevenue = item.price * item.quantity;
      if (existing) {
        existing.revenue += itemRevenue;
        existing.quantity += item.quantity;
      } else {
        productMap.set(item.name, { revenue: itemRevenue, quantity: item.quantity });
      }
    }

    const topProducts = Array.from(productMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const lastShop = await prisma.shopifyShop.findFirst({
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
    logger.error("[Shopify Stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
