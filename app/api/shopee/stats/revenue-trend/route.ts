/**
 * Shopee Revenue Trend — Daily/Weekly/Monthly aggregation
 * GET /api/shopee/stats/revenue-trend
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
    const granularity = searchParams.get("granularity") || "daily"; // daily | weekly | monthly
    const dateFrom = searchParams.get("dateFrom"); // ISO date string
    const dateTo = searchParams.get("dateTo"); // ISO date string

    const cacheKey = `shopee:revenue-trend:${shopId || "all"}:${granularity}:${dateFrom || "all"}:${dateTo || "all"}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = Number(shopId);

    const shops = await prisma.shopeeShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      return NextResponse.json({ data: [], granularity });
    }

    // Build date filter
    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    } else {
      // Default: last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      dateFilter.gte = ninetyDaysAgo;
    }

    // Fetch all orders and aggregate in memory for date grouping
    const orders = await prisma.shopeeOrder.findMany({
      where: {
        shopId: { in: shopIds },
        orderStatus: { not: "CANCELLED" },
        shopeeCreatedAt: { not: null },
        ...(dateFilter.gte || dateFilter.lte ? {
          shopeeCreatedAt: {
            ...(dateFilter.gte ? { gte: dateFilter.gte as Date } : {}),
            ...(dateFilter.lte ? { lte: dateFilter.lte as Date } : {}),
          },
        } : {}),
      },
      select: {
        shopeeCreatedAt: true,
        totalAmount: true,
      },
    });

    // Group by period
    const grouped: Record<string, { revenue: number; orders: number }> = {};
    for (const order of orders) {
      if (!order.shopeeCreatedAt) continue;
      let period: string;
      const date = new Date(order.shopeeCreatedAt);

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
    logger.error("[Shopee Revenue Trend] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue trend" },
      { status: 500 },
    );
  }
}
