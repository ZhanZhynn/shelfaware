/**
 * Shopee Sync Logs — List Sync History
 * GET /api/shopee/sync/logs
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { marketplaceCacheScope, marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerIds = await marketplaceOwnerIds(session);
    const cacheScope = marketplaceCacheScope(session);
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get("shopId");

    const cacheKey = `${cacheKeys.shopee.syncLogs(shopId || "all")}:${cacheScope}`;

    // Check cache
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Record<string, unknown> = { userId: { in: ownerIds } };
    if (shopId) {
      // shopId from URL is the Shopee numeric ID — look up the ObjectId
      const shop = await prisma.shopeeShop.findFirst({
        where: { shopId: Number(shopId), userId: { in: ownerIds } },
        select: { id: true },
      });
      if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      where.shopId = shop.id;
    }

    const logs = await prisma.shopeeSyncLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    // Cache for 2 minutes
    await setCache(cacheKey, logs, 120);

    return NextResponse.json(logs);
  } catch (error) {
    logger.error("[Shopee Sync Logs] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sync logs" },
      { status: 500 },
    );
  }
}
