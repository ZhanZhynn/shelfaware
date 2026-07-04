/**
 * Shopee Profit Tracking — Fees, commission, ROI per product
 * GET /api/shopee/stats/profit
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

    const cacheKey = `shopee:profit:${shopId || "all"}`;
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
        summary: {
          totalRevenue: 0,
          totalCommission: 0,
          totalServiceFee: 0,
          totalSellerTxnFee: 0,
          totalShippingFee: 0,
          totalSellerIncome: 0,
          overallMargin: 0,
        },
        byProduct: [],
        feeBreakdown: [],
      });
    }

    // Aggregate fees from orders
    const feeAggregation = await prisma.shopeeOrder.aggregate({
      where: {
        shopId: { in: shopIds },
        orderStatus: { not: "CANCELLED" },
      },
      _sum: {
        totalAmount: true,
        commissionFee: true,
        serviceFee: true,
        sellerTxnFee: true,
        shippingFee: true,
        sellerIncome: true,
      },
      _count: true,
    });

    const totalRevenue = Number(feeAggregation._sum.totalAmount || 0);
    const totalCommission = Number(feeAggregation._sum.commissionFee || 0);
    const totalServiceFee = Number(feeAggregation._sum.serviceFee || 0);
    const totalSellerTxnFee = Number(feeAggregation._sum.sellerTxnFee || 0);
    const totalShippingFee = Number(feeAggregation._sum.shippingFee || 0);
    const totalSellerIncome = Number(feeAggregation._sum.sellerIncome || 0);
    const totalOrders = feeAggregation._count;

    const overallMargin = totalRevenue > 0
      ? Math.round(((totalSellerIncome / totalRevenue) * 100) * 100) / 100
      : 0;

    // Fee breakdown
    const totalFees = totalCommission + totalServiceFee + totalSellerTxnFee + totalShippingFee;
    const feeBreakdown = [
      { name: "Commission Fee", amount: totalCommission, percentage: totalRevenue > 0 ? Math.round((totalCommission / totalRevenue) * 10000) / 100 : 0 },
      { name: "Service Fee", amount: totalServiceFee, percentage: totalRevenue > 0 ? Math.round((totalServiceFee / totalRevenue) * 10000) / 100 : 0 },
      { name: "Seller Transaction Fee", amount: totalSellerTxnFee, percentage: totalRevenue > 0 ? Math.round((totalSellerTxnFee / totalRevenue) * 10000) / 100 : 0 },
      { name: "Shipping Fee", amount: totalShippingFee, percentage: totalRevenue > 0 ? Math.round((totalShippingFee / totalRevenue) * 10000) / 100 : 0 },
    ];

    // Profit per product (based on order items)
    const profitByProductRaw = await prisma.shopeeOrderItem.groupBy({
      by: ["productName"],
      where: {
        order: {
          shopId: { in: shopIds },
          orderStatus: { not: "CANCELLED" },
        },
      },
      _sum: { subtotal: true, quantity: true },
      _count: true,
      orderBy: { _sum: { subtotal: "desc" } },
    });

    // Proportional fee allocation per product
    const byProduct = profitByProductRaw.map((item) => {
      const productRevenue = Number(item._sum.subtotal || 0);
      const productQuantity = Number(item._sum.quantity || 0);
      const orderCount = item._count;

      // Proportional fee allocation
      const revenueShare = totalRevenue > 0 ? productRevenue / totalRevenue : 0;
      const allocatedCommission = totalCommission * revenueShare;
      const allocatedServiceFee = totalServiceFee * revenueShare;
      const allocatedSellerTxnFee = totalSellerTxnFee * revenueShare;
      const allocatedShippingFee = totalShippingFee * revenueShare;
      const totalAllocatedFees = allocatedCommission + allocatedServiceFee + allocatedSellerTxnFee + allocatedShippingFee;

      const estimatedProfit = productRevenue - totalAllocatedFees;
      const margin = productRevenue > 0
        ? Math.round(((estimatedProfit / productRevenue) * 100) * 100) / 100
        : 0;

      return {
        productName: item.productName,
        revenue: productRevenue,
        quantitySold: productQuantity,
        orderCount,
        estimatedFees: Math.round(totalAllocatedFees * 100) / 100,
        estimatedProfit: Math.round(estimatedProfit * 100) / 100,
        margin,
      };
    });

    const result = {
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        totalServiceFee: Math.round(totalServiceFee * 100) / 100,
        totalSellerTxnFee: Math.round(totalSellerTxnFee * 100) / 100,
        totalShippingFee: Math.round(totalShippingFee * 100) / 100,
        totalSellerIncome: Math.round(totalSellerIncome * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        overallMargin,
        totalOrders,
        avgOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        avgFeePerOrder: totalOrders > 0 ? Math.round((totalFees / totalOrders) * 100) / 100 : 0,
      },
      byProduct,
      feeBreakdown,
    };

    await setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Profit Tracking] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profit data" },
      { status: 500 },
    );
  }
}
