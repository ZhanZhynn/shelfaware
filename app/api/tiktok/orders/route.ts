/**
 * TikTok Orders — List orders from local DB
 * GET /api/tiktok/orders
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { tiktokOrderListQuerySchema } from "@/lib/validations/tiktok";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const queryResult = tiktokOrderListQuerySchema.safeParse({
      shopId: searchParams.get("shopId") || undefined,
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

    const { shopId, page, limit, status, createdAfter } = queryResult.data;
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = { userId };
    if (shopId) {
      const shop = await prisma.tikTokShop.findFirst({
        where: { shopId, userId },
        select: { id: true },
      });
      if (shop) where.shopId = shop.id;
    }
    if (status) where.orderStatus = status;
    if (createdAfter) {
      where.tiktokCreatedAt = { gte: new Date(createdAfter) };
    }

    const cacheKey = `tiktok:orders:${shopId || "all"}:${page}:${limit}:${status || ""}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [orders, total] = await Promise.all([
      prisma.tikTokOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { tiktokCreatedAt: "desc" },
        include: {
          items: true,
        },
      }),
      prisma.tikTokOrder.count({ where }),
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
    logger.error("[TikTok Orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}
