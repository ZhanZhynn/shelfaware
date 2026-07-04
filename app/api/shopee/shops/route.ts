/**
 * Shopee Shops — List Connected Shops
 * GET /api/shopee/shops
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { isShopeeConfigured } from "@/lib/shopee";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isShopeeConfigured()) {
      return NextResponse.json(
        { error: "Shopee integration is not configured" },
        { status: 503 },
      );
    }

    const userId = session.id;
    const cacheKey = cacheKeys.shopee.shops(userId);

    // Check cache
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const shops = await prisma.shopeeShop.findMany({
      where: { userId },
      select: {
        id: true,
        shopId: true,
        shopName: true,
        shopStatus: true,
        region: true,
        merchantId: true,
        isCb: true,
        lastSyncedAt: true,
        createdAt: true,
        lowStockThreshold: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Cache for 5 minutes
    await setCache(cacheKey, shops, 300);

    return NextResponse.json(shops);
  } catch (error) {
    logger.error("[Shopee Shops] Error fetching shops:", error);
    return NextResponse.json(
      { error: "Failed to fetch shops" },
      { status: 500 },
    );
  }
}
