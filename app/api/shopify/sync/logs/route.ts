/**
 * Shopify Sync Logs — List Sync History
 * GET /api/shopify/sync/logs?shopId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
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

    const cacheKey = `shopify:syncLogs:${shopId || "all"}:${cacheScope}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const where: Record<string, unknown> = { userId: { in: ownerIds }, channel: "shopify" };
    if (shopId) {
      // Verify ownership
      const shop = await prisma.shopifyShop.findFirst({
        where: { id: shopId, userId: { in: ownerIds } },
        select: { id: true },
      });
      if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      where.shopId = shop.id;
    }

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    await setCache(cacheKey, logs, 120);
    return NextResponse.json(logs);
  } catch (error) {
    logger.error("[Shopify Sync Logs] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sync logs" },
      { status: 500 },
    );
  }
}
