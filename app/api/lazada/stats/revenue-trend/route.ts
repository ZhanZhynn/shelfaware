/**
 * Lazada Revenue Trend — Daily/Weekly/Monthly aggregation
 * GET /api/lazada/stats/revenue-trend
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
    const sellerId = searchParams.get("sellerId");
    const granularity = searchParams.get("granularity") || "daily";
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const cacheKey = `lazada:revenue-trend:${sellerId || "all"}:${granularity}:${dateFrom || "all"}:${dateTo || "all"}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shopWhere: Record<string, unknown> = { userId };
    if (sellerId) shopWhere.sellerId = sellerId;

    const shops = await prisma.lazadaShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      return NextResponse.json({ data: [], granularity });
    }

    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    } else {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      dateFilter.gte = ninetyDaysAgo;
    }

    const orders = await prisma.lazadaOrder.findMany({
      where: {
        shopId: { in: shopIds },
        orderStatus: { not: "cancelled" },
        lazadaCreatedAt: { not: null },
        ...(dateFilter.gte || dateFilter.lte ? {
          lazadaCreatedAt: {
            ...(dateFilter.gte ? { gte: dateFilter.gte as Date } : {}),
            ...(dateFilter.lte ? { lte: dateFilter.lte as Date } : {}),
          },
        } : {}),
      },
      select: {
        lazadaCreatedAt: true,
        totalAmount: true,
      },
    });

    const grouped: Record<string, { revenue: number; orders: number }> = {};
    for (const order of orders) {
      if (!order.lazadaCreatedAt) continue;
      let period: string;
      const date = new Date(order.lazadaCreatedAt);

      switch (granularity) {
        case "weekly": {
          const startOfYear = new Date(date.getFullYear(), 0, 1);
          const weekNumber = Math.ceil(((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
          period = `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
          break;
        }
        case "monthly":
          period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          break;
        default:
          period = date.toISOString().split("T")[0] || "";
      }

      if (!grouped[period]) {
        grouped[period] = { revenue: 0, orders: 0 };
      }
      const entry = grouped[period];
      if (entry) {
        entry.revenue += Number(order.totalAmount);
        entry.orders++;
      }
    }

    const rawData = Object.entries(grouped)
      .map(([period, data]) => ({ period, ...data }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const data = rawData.map((row) => ({
      period: row.period,
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    }));

    await setCache(cacheKey, { data, granularity }, 300);

    return NextResponse.json({ data, granularity });
  } catch (error) {
    logger.error("[Lazada Revenue Trend] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue trend" },
      { status: 500 },
    );
  }
}
