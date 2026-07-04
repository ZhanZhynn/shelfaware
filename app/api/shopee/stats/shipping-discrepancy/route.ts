/**
 * Shopee Shipping Fee Discrepancy
 * GET /api/shopee/stats/shipping-discrepancy
 * Returns products where estimated shipping fee differs from actual shipping fee.
 * Useful for identifying products that need weight/dimension corrections.
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
    const threshold = Number(searchParams.get("threshold") || "10"); // % threshold for "significant" discrepancy

    const cacheKey = `shopee:shipping-discrepancy:${shopId || "all"}:${threshold}`;
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
        summary: { totalOrders: 0, ordersWithDiscrepancy: 0, totalEstimated: 0, totalActual: 0, totalDiscrepancy: 0 },
        products: [],
      });
    }

    // Get non-cancelled orders with shipping fee data
    const orders = await prisma.shopeeOrder.findMany({
      where: {
        shopId: { in: shopIds },
        orderStatus: { not: "CANCELLED" },
        estimatedShippingFee: { gt: 0 },
      },
      select: {
        id: true,
        shopeeOrderId: true,
        estimatedShippingFee: true,
        shippingFee: true,
        totalAmount: true,
        orderStatus: true,
        shopeeCreatedAt: true,
        items: {
          select: {
            productName: true,
            quantity: true,
            subtotal: true,
          },
        },
      },
    });

    // Aggregate by product
    const productMap = new Map<
      string,
      {
        orderCount: number;
        totalEstimated: number;
        totalActual: number;
        totalRevenue: number;
        totalQuantity: number;
        orders: { orderId: string; estimated: number; actual: number; discrepancy: number; discrepancyPct: number; date: string | null }[];
      }
    >();

    let ordersWithDiscrepancy = 0;
    let globalEstimated = 0;
    let globalActual = 0;

    for (const order of orders) {
      const estimated = order.estimatedShippingFee || 0;
      const actual = order.shippingFee || 0;

      if (estimated === 0 && actual === 0) continue;

      const discrepancy = actual - estimated;
      const discrepancyPct = estimated > 0 ? (discrepancy / estimated) * 100 : 0;

      globalEstimated += estimated;
      globalActual += actual;

      if (Math.abs(discrepancyPct) > threshold) {
        ordersWithDiscrepancy++;
      }

      // Aggregate per product (use first item's product name, or "Unknown")
      for (const item of order.items) {
        const name = item.productName || "Unknown Product";
        if (!productMap.has(name)) {
          productMap.set(name, {
            orderCount: 0,
            totalEstimated: 0,
            totalActual: 0,
            totalRevenue: 0,
            totalQuantity: 0,
            orders: [],
          });
        }
        const entry = productMap.get(name)!;
        entry.orderCount++;
        entry.totalEstimated += estimated;
        entry.totalActual += actual;
        entry.totalRevenue += item.subtotal;
        entry.totalQuantity += item.quantity;
        entry.orders.push({
          orderId: order.shopeeOrderId,
          estimated,
          actual,
          discrepancy,
          discrepancyPct: Math.round(discrepancyPct * 100) / 100,
          date: order.shopeeCreatedAt?.toISOString() || null,
        });
      }
    }

    // Build product list sorted by absolute discrepancy
    const products = Array.from(productMap.entries())
      .map(([productName, data]) => {
        const avgDiscrepancy = data.orderCount > 0 ? (data.totalActual - data.totalEstimated) / data.orderCount : 0;
        const avgDiscrepancyPct = data.totalEstimated > 0 ? ((data.totalActual - data.totalEstimated) / data.totalEstimated) * 100 : 0;

        return {
          productName,
          orderCount: data.orderCount,
          totalEstimated: Math.round(data.totalEstimated * 100) / 100,
          totalActual: Math.round(data.totalActual * 100) / 100,
          avgDiscrepancy: Math.round(avgDiscrepancy * 100) / 100,
          discrepancyPct: Math.round(avgDiscrepancyPct * 100) / 100,
          totalRevenue: Math.round(data.totalRevenue * 100) / 100,
          totalQuantity: data.totalQuantity,
        };
      })
      .sort((a, b) => Math.abs(b.avgDiscrepancy) - Math.abs(a.avgDiscrepancy));

    const result = {
      summary: {
        totalOrders: orders.length,
        ordersWithDiscrepancy,
        totalEstimated: Math.round(globalEstimated * 100) / 100,
        totalActual: Math.round(globalActual * 100) / 100,
        totalDiscrepancy: Math.round((globalActual - globalEstimated) * 100) / 100,
        threshold,
      },
      products,
    };

    await setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Shipping Discrepancy] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipping discrepancy data" },
      { status: 500 },
    );
  }
}
