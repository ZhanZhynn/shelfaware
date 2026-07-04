/**
 * Shopee Near-SLA Orders — orders approaching their ship-by deadline
 * GET /api/shopee/orders/near-sla?hours=24
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { z } from "zod";

const querySchema = z.object({
  hours: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 24))
    .pipe(z.number().int().min(1).max(168)),
  shopId: z.string().optional(),
});

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

    const parsed = querySchema.safeParse({
      hours: searchParams.get("hours") || undefined,
      shopId: searchParams.get("shopId") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { hours, shopId } = parsed.data;
    const cacheKey = `shopee:near-sla:${shopId || "all"}:${hours}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = Number(shopId);

    const shops = await prisma.shopeeShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      return NextResponse.json({
        total: 0,
        orders: [],
        thresholdHours: hours,
      });
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const orders = await prisma.shopeeOrder.findMany({
      where: {
        shopId: { in: shopIds },
        orderStatus: { in: ["confirmed", "processing"] },
        shipByDate: { not: null, lte: deadline },
      },
      orderBy: { shipByDate: "asc" },
      select: {
        id: true,
        shopeeOrderId: true,
        orderStatus: true,
        shipByDate: true,
        totalAmount: true,
        buyerUsername: true,
        packageNumber: true,
        fulfillmentStatus: true,
        daysToShip: true,
      },
    });

    const result = {
      total: orders.length,
      thresholdHours: hours,
      orders: orders.map((o) => {
        const msRemaining = (o.shipByDate?.getTime() ?? 0) - now.getTime();
        const hoursRemaining =
          Math.round((msRemaining / (1000 * 60 * 60)) * 100) / 100;
        let urgency: "critical" | "high" | "medium";
        if (hoursRemaining < 6) urgency = "critical";
        else if (hoursRemaining < 12) urgency = "high";
        else urgency = "medium";

        return {
          id: o.id,
          orderId: o.shopeeOrderId,
          orderStatus: o.orderStatus,
          shipByDate: o.shipByDate?.toISOString() ?? null,
          hoursRemaining,
          urgency,
          buyerUsername: o.buyerUsername,
          totalAmount: o.totalAmount,
          packageNumber: o.packageNumber,
          fulfillmentStatus: o.fulfillmentStatus,
          daysToShip: o.daysToShip,
        };
      }),
    };

    await setCache(cacheKey, result, 60);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Near-SLA] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch near-SLA orders" },
      { status: 500 },
    );
  }
}
