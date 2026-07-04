/**
 * Shopee Buyer Analytics — Repeat buyers, geographic distribution, spending tiers
 * GET /api/shopee/stats/buyers
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

    const cacheKey = `shopee:buyers:${shopId || "all"}`;
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
        totalBuyers: 0,
        repeatBuyers: 0,
        repeatRate: 0,
        avgOrdersPerBuyer: 0,
        topBuyers: [],
        geographicDistribution: [],
        spendingTiers: [],
      });
    }

    // Buyer aggregation queries
    const [
      totalBuyersResult,
      repeatBuyersResult,
      avgOrdersResult,
      topBuyersRaw,
      geographicRaw,
      spendingRaw,
    ] = await Promise.all([
      // Total unique buyers
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
      }),
      // Repeat buyers (2+ orders)
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
        _count: true,
        having: {
          buyerUsername: { _count: { gte: 2 } },
        },
      }),
      // Average orders per buyer
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
        _count: true,
      }),
      // Top 10 buyers by total spend
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
        _sum: { totalAmount: true },
        _count: true,
        orderBy: { _sum: { totalAmount: "desc" } },
        take: 10,
      }),
      // Geographic distribution from shipping addresses
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
        _sum: { totalAmount: true },
      }),
      // Spending tiers
      prisma.shopeeOrder.groupBy({
        by: ["buyerUsername"],
        where: {
          shopId: { in: shopIds },
          buyerUsername: { not: "" },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    const totalBuyers = totalBuyersResult.length;
    const repeatBuyers = repeatBuyersResult.length;
    const repeatRate = totalBuyers > 0 ? (repeatBuyers / totalBuyers) * 100 : 0;

    const totalOrdersCount = avgOrdersResult.reduce((sum, b) => sum + b._count, 0);
    const avgOrdersPerBuyer = totalBuyers > 0 ? totalOrdersCount / totalBuyers : 0;

    // Top buyers
    const topBuyers = topBuyersRaw.map((b) => ({
      username: b.buyerUsername,
      totalSpent: Number(b._sum.totalAmount || 0),
      orderCount: b._count,
    }));

    // Geographic distribution (extract from shipping addresses + order-level region)
    const allOrdersWithAddress = await prisma.shopeeOrder.findMany({
      where: {
        shopId: { in: shopIds },
        shippingAddress: { not: null },
      },
      select: { shippingAddress: true, region: true },
    });

    // Country code mapping for common Shopee regions
    const COUNTRY_NAMES: Record<string, string> = {
      SG: "Singapore", MY: "Malaysia", ID: "Indonesia", TH: "Thailand",
      PH: "Philippines", VN: "Vietnam", TW: "Taiwan", BR: "Brazil",
      MX: "Mexico", CL: "Chile", CO: "Colombia", PL: "Poland",
    };

    const regionCounts: Record<string, number> = {};
    for (const order of allOrdersWithAddress) {
      const addr = order.shippingAddress as Record<string, unknown> | null;

      // Check if address fields are masked (all "****")
      const isMasked = addr && typeof addr === "object"
        && ["****", "*"].includes(String(addr.district || ""))
        && ["****", "*"].includes(String(addr.state || ""));

      let region: string;
      if (!isMasked && addr?.state && String(addr.state).trim() && String(addr.state) !== "****") {
        // Unmasked: use state (province) as the primary region
        region = String(addr.state).trim();
      } else if (!isMasked && addr?.city && String(addr.city).trim() && String(addr.city) !== "****") {
        // State missing — fall back to city
        region = String(addr.city).trim();
      } else if (order.region) {
        // Masked or missing: fall back to order-level region (country code)
        const code = order.region;
        region = COUNTRY_NAMES[code] || code;
      } else {
        region = "Unknown";
      }

      regionCounts[region] = (regionCounts[region] || 0) + 1;
    }

    const geographicDistribution = Object.entries(regionCounts)
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Spending tiers
    const tiers = { under50: 0, "50to200": 0, "200to500": 0, over500: 0 };
    for (const buyer of spendingRaw) {
      const total = Number(buyer._sum.totalAmount || 0);
      if (total < 50) tiers.under50++;
      else if (total < 200) tiers["50to200"]++;
      else if (total < 500) tiers["200to500"]++;
      else tiers.over500++;
    }

    const spendingTiers = [
      { tier: "Under $50", count: tiers.under50 },
      { tier: "$50 - $200", count: tiers["50to200"] },
      { tier: "$200 - $500", count: tiers["200to500"] },
      { tier: "Over $500", count: tiers.over500 },
    ];

    const result = {
      totalBuyers,
      repeatBuyers,
      repeatRate: Math.round(repeatRate * 100) / 100,
      avgOrdersPerBuyer: Math.round(avgOrdersPerBuyer * 100) / 100,
      topBuyers,
      geographicDistribution,
      spendingTiers,
    };

    await setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Buyer Analytics] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch buyer analytics" },
      { status: 500 },
    );
  }
}
