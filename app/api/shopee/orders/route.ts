/**
 * Shopee Orders — List Orders (from local DB)
 * GET /api/shopee/orders
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { shopeeOrderListQuerySchema } from "@/lib/validations/shopee";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { marketplaceCacheScope, marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerIds = await marketplaceOwnerIds(session);
    const cacheScope = marketplaceCacheScope(session);
    const { searchParams } = new URL(request.url);

    const query = {
      shopId: searchParams.get("shopId") || undefined,
      page: Number(searchParams.get("page") || 1),
      limit: Number(searchParams.get("limit") || 20),
      status: searchParams.get("status") || undefined,
    };

    const validationResult = shopeeOrderListQuerySchema.safeParse(query);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters" },
        { status: 400 },
      );
    }

    const { shopId, page, limit, status } = validationResult.data;
    const skip = (page - 1) * limit;

    const cacheKey = `${cacheKeys.shopee.orders(shopId || "all", { page, limit, status })}:${cacheScope}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Record<string, unknown> = { userId: { in: ownerIds } };
    // shopId from URL is the Shopee numeric ID — look up the ObjectId
    if (shopId) {
      const shop = await prisma.shopeeShop.findFirst({
        where: { shopId: Number(shopId), userId: { in: ownerIds } },
        select: { id: true },
      });
      if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      where.shopId = shop.id;
    }
    if (status) where.orderStatus = status;

    const [orders, total] = await Promise.all([
      prisma.shopeeOrder.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.shopeeOrder.count({ where }),
    ]);

    const result = { orders, total, page, limit };
    await setCache(cacheKey, result, 120);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}
