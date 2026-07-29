/**
 * Shopify Shops — List connected shops
 * GET /api/shopify/shops
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
    const cacheKey = `shopify:shops:${marketplaceCacheScope(session)}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const shops = await prisma.shopifyShop.findMany({
      where: { userId: { in: ownerIds } },
      select: {
        id: true,
        shopDomain: true,
        shopName: true,
        scopes: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    await setCache(cacheKey, shops, 120);
    return NextResponse.json(shops);
  } catch (error) {
    logger.error("[Shopify Shops] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shops" },
      { status: 500 },
    );
  }
}
