/**
 * Lazada Orders — List orders from local DB
 * GET /api/lazada/orders
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { cacheKeys, getCache, setCache } from "@/lib/cache";
import { lazadaOrderListQuerySchema } from "@/lib/validations/lazada";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const queryResult = lazadaOrderListQuerySchema.safeParse({
      sellerId: searchParams.get("sellerId") || undefined,
      page: searchParams.get("page") || undefined,
      limit: searchParams.get("limit") || undefined,
      status: searchParams.get("status") || undefined,
      createdAfter: searchParams.get("createdAfter") || undefined,
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query", details: queryResult.error.flatten() },
        { status: 400 },
      );
    }

    const { sellerId, page, limit, status, createdAfter } = queryResult.data;
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = { userId };
    if (sellerId) {
      const shop = await prisma.lazadaShop.findFirst({
        where: { sellerId, userId },
        select: { id: true },
      });
      if (shop) where.shopId = shop.id;
    }
    if (status) where.orderStatus = status;
    if (createdAfter) {
      where.lazadaCreatedAt = { gte: new Date(createdAfter) };
    }

    const cacheKey = cacheKeys.lazada.orders(sellerId || "all", { page, limit, status });
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [orders, total] = await Promise.all([
      prisma.lazadaOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lazadaCreatedAt: "desc" },
        include: {
          items: true,
        },
      }),
      prisma.lazadaOrder.count({ where }),
    ]);

    const result = {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    await setCache(cacheKey, result, 120);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Lazada Orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}
