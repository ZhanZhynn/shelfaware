/**
 * Shopee Customer Lifetime Value (CLV) Analytics
 * GET /api/shopee/stats/clv
 * Computes RFM segmentation, churn risk, and CLV estimates per buyer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get("shopId");

    const cacheKey = `shopee:clv:${shopId || "all"}`;
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
      return NextResponse.json({
        summary: { totalBuyers: 0, avgClv: 0, avgRecency: 0, avgFrequency: 0, avgMonetary: 0 },
        segments: { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 },
        churnRisk: { high: 0, medium: 0, low: 0 },
        topBuyersByClv: [],
      });
    }

    // Extend the buyers groupBy with _min/_max on shopeeCreatedAt for recency + lifetime
    const buyerAgg = await prisma.shopeeOrder.groupBy({
      by: ["buyerUsername"],
      where: {
        shopId: { in: shopIds },
        buyerUsername: { not: "" },
        orderStatus: { not: "CANCELLED" },
      },
      _sum: { totalAmount: true, sellerIncome: true },
      _count: true,
      _min: { shopeeCreatedAt: true },
      _max: { shopeeCreatedAt: true },
    });

    const now = new Date();
    const totalBuyers = buyerAgg.length;

    if (totalBuyers === 0) {
      return NextResponse.json({
        summary: { totalBuyers: 0, avgClv: 0, avgRecency: 0, avgFrequency: 0, avgMonetary: 0 },
        segments: { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 },
        churnRisk: { high: 0, medium: 0, low: 0 },
        topBuyersByClv: [],
      });
    }

    // Compute RFM per buyer
    const buyers = buyerAgg.map((b) => {
      const totalSpent = Number(b._sum.totalAmount || 0);
      const totalIncome = Number(b._sum.sellerIncome || 0);
      const orderCount = b._count;
      const firstOrder = b._min.shopeeCreatedAt ? new Date(b._min.shopeeCreatedAt) : now;
      const lastOrder = b._max.shopeeCreatedAt ? new Date(b._max.shopeeCreatedAt) : now;

      const recencyDays = Math.max(0, (now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24));
      const lifetimeDays = Math.max(1, (lastOrder.getTime() - firstOrder.getTime()) / (1000 * 60 * 60 * 24));
      const frequency = orderCount;
      const monetary = totalSpent / orderCount; // avg order value

      // Frequency rate: orders per month
      const frequencyRate = lifetimeDays > 0 ? (frequency / lifetimeDays) * 30 : frequency;

      // Simple CLV estimate: avg order value × frequency rate × 12 months × retention factor
      const retentionFactor = recencyDays < 90 ? 1.0 : recencyDays < 180 ? 0.7 : 0.4;
      const clvEstimate = monetary * frequencyRate * 12 * retentionFactor;

      return {
        username: b.buyerUsername,
        orderCount,
        totalSpent,
        totalIncome,
        avgOrderValue: Math.round(monetary * 100) / 100,
        recencyDays: Math.round(recencyDays),
        lifetimeDays: Math.round(lifetimeDays),
        frequencyRate: Math.round(frequencyRate * 100) / 100,
        clvEstimate: Math.round(clvEstimate * 100) / 100,
        firstOrderDate: firstOrder.toISOString(),
        lastOrderDate: lastOrder.toISOString(),
      };
    });

    // RFM segmentation
    // R: Recency (lower is better), F: Frequency (higher is better), M: Monetary (higher is better)
    const recencyP50 = percentile(buyers.map((b) => b.recencyDays), 50);
    const frequencyP50 = percentile(buyers.map((b) => b.orderCount), 50);
    const monetaryP50 = percentile(buyers.map((b) => b.totalSpent), 50);

    let champions = 0, loyal = 0, potential = 0, atRisk = 0, lost = 0;

    for (const b of buyers) {
      const rGood = b.recencyDays <= recencyP50;
      const fGood = b.orderCount >= frequencyP50;
      const mGood = b.totalSpent >= monetaryP50;

      if (rGood && fGood && mGood) champions++;
      else if (rGood && fGood) loyal++;
      else if (rGood && mGood) potential++;
      else if (!rGood && (fGood || mGood)) atRisk++;
      else lost++;
    }

    // Churn risk
    let churnHigh = 0, churnMedium = 0, churnLow = 0;
    for (const b of buyers) {
      if (b.recencyDays > 90) churnHigh++;
      else if (b.recencyDays > 60) churnMedium++;
      else churnLow++;
    }

    // Summary
    const totalClv = buyers.reduce((sum, b) => sum + b.clvEstimate, 0);
    const totalRecency = buyers.reduce((sum, b) => sum + b.recencyDays, 0);
    const totalFrequency = buyers.reduce((sum, b) => sum + b.orderCount, 0);
    const totalMonetary = buyers.reduce((sum, b) => sum + b.totalSpent, 0);

    // Top buyers by CLV
    const topBuyersByClv = [...buyers]
      .sort((a, b) => b.clvEstimate - a.clvEstimate)
      .slice(0, 10)
      .map((b) => ({
        username: b.username,
        clvEstimate: b.clvEstimate,
        orderCount: b.orderCount,
        avgOrderValue: b.avgOrderValue,
        recencyDays: b.recencyDays,
        totalSpent: b.totalSpent,
      }));

    const result = {
      summary: {
        totalBuyers,
        avgClv: Math.round((totalClv / totalBuyers) * 100) / 100,
        avgRecency: Math.round(totalRecency / totalBuyers),
        avgFrequency: Math.round((totalFrequency / totalBuyers) * 100) / 100,
        avgMonetary: Math.round((totalMonetary / totalBuyers) * 100) / 100,
      },
      segments: { champions, loyal, potential, atRisk, lost },
      churnRisk: { high: churnHigh, medium: churnMedium, low: churnLow },
      topBuyersByClv,
    };

    await setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee CLV] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch CLV analytics" },
      { status: 500 },
    );
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
