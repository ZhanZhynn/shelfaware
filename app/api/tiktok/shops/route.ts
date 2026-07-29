/**
 * TikTok Shops — List connected shops
 * GET /api/tiktok/shops
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { cacheKeys, getCache, setCache } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { marketplaceCacheScope, marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerIds = await marketplaceOwnerIds(session);
    const cacheKey = `tiktok:shops:${marketplaceCacheScope(session)}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const shops = await prisma.tikTokShop.findMany({
      where: { userId: { in: ownerIds } },
      select: {
        id: true,
        shopId: true,
        shopName: true,
        region: true,
        sellerType: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    await setCache(cacheKey, shops, 120);
    return NextResponse.json(shops);
  } catch (error) {
    logger.error("[TikTok Shops] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shops" },
      { status: 500 },
    );
  }
}
