/**
 * TikTok Stats — Aggregated Statistics
 * GET /api/tiktok/stats
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

    const cacheKey = cacheKeys.tiktok.stats(shopId || "all", dateRangeKey);
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = shopId;

    const shops = await prisma.tikTokShop.findMany({
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
      orderWhere.tiktokCreatedAt = dateFilter;
    }

    const orderItemWhere: Record<string, unknown> = {
      order: { shopId: { in: shopIds } },
    };
    if (hasDateFilter) {
      orderItemWhere.order = {
        shopId: { in: shopIds },
        tiktokCreatedAt: dateFilter,
      };
    }

    const [totalProducts, totalOrders, ordersByStatus, revenueStats] =
      await Promise.all([
        prisma.tikTokProduct.count({
          where: { shopId: { in: shopIds } },
        }),
        prisma.tikTokOrder.count({
          where: orderWhere,
        }),
        prisma.tikTokOrder.groupBy({
          by: ["orderStatus"],
          where: orderWhere,
          _count: true,
        }),
        prisma.tikTokOrderItem.aggregate({
          where: orderItemWhere,
          _sum: { subtotalAmount: true },
        }),
      ]);

    const orderItems = await prisma.tikTokOrderItem.findMany({
      where: orderItemWhere,
      select: { productName: true, price: true, quantity: true },
    });

    const productRevenue: Record<string, { revenue: number; quantity: number }> = {};
    for (const item of orderItems) {
      const entry = productRevenue[item.productName] ?? { revenue: 0, quantity: 0 };
      entry.revenue += item.price * item.quantity;
      entry.quantity += item.quantity;
      productRevenue[item.productName] = entry;
    }

    const topProducts = Object.entries(productRevenue)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const lastShop = await prisma.tikTokShop.findFirst({
      where: { id: { in: shopIds } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    });

    const statusMap: Record<string, number> = {};
    for (const s of ordersByStatus) {
      statusMap[s.orderStatus] = s._count;
    }

    const totalRevenue = revenueStats._sum.subtotalAmount || 0;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const stats = {
      totalProducts,
      totalOrders,
      totalRevenue,
      averageOrderValue,
      ordersByStatus: statusMap,
      topProducts,
      lastSyncedAt: lastShop?.lastSyncedAt || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    };

    await setCache(cacheKey, stats, 120);

    return NextResponse.json(stats);
  } catch (error) {
    logger.error("[TikTok Stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
