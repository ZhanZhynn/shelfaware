/**
 * Shopee Returns Stats
 * GET /api/shopee/stats/returns
 * Returns analytics: return rate, refund totals, top reasons, status breakdown
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
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

    const cacheKey = `shopee:returns-stats:${shopId || "all"}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = shopId;

    const shops = await prisma.shopeeShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      return NextResponse.json({
        summary: { totalReturns: 0, totalRefundAmount: 0, returnRate: 0, avgRefund: 0 },
        byStatus: [],
        topReasons: [],
        recentReturns: [],
      });
    }

    // Parallel queries
    const [
      totalOrders,
      totalReturns,
      returnsByStatus,
      topReasonsRaw,
      refundAgg,
      recentReturns,
    ] = await Promise.all([
      prisma.shopeeOrder.count({
        where: { shopId: { in: shopIds }, orderStatus: { not: "CANCELLED" } },
      }),
      prisma.shopeeReturn.count({
        where: { shopId: { in: shopIds } },
      }),
      prisma.shopeeReturn.groupBy({
        by: ["status"],
        where: { shopId: { in: shopIds } },
        _count: true,
      }),
      prisma.shopeeReturn.groupBy({
        by: ["reason"],
        where: { shopId: { in: shopIds }, reason: { not: "" } },
        _count: true,
        orderBy: { _count: { reason: "desc" } },
        take: 10,
      }),
      prisma.shopeeReturn.aggregate({
        where: { shopId: { in: shopIds } },
        _sum: { refundAmount: true },
        _avg: { refundAmount: true },
      }),
      prisma.shopeeReturn.findMany({
        where: { shopId: { in: shopIds } },
        orderBy: { shopeeCreatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          returnSn: true,
          orderSn: true,
          status: true,
          refundAmount: true,
          reason: true,
          buyerUsername: true,
          shopeeCreatedAt: true,
        },
      }),
    ]);

    const returnRate = totalOrders > 0 ? (totalReturns / totalOrders) * 100 : 0;
    const totalRefundAmount = Number(refundAgg._sum.refundAmount || 0);
    const avgRefund = Number(refundAgg._avg.refundAmount || 0);

    const byStatus = returnsByStatus.map((s) => ({
      status: s.status,
      count: s._count,
    }));

    const topReasons = topReasonsRaw.map((r) => ({
      reason: r.reason,
      count: r._count,
    }));

    const result = {
      summary: {
        totalReturns,
        totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
        returnRate: Math.round(returnRate * 100) / 100,
        avgRefund: Math.round(avgRefund * 100) / 100,
      },
      byStatus,
      topReasons,
      recentReturns,
    };

    await setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Returns Stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch returns stats" },
      { status: 500 },
    );
  }
}
