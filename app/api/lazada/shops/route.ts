/**
 * Lazada Shops — List connected sellers
 * GET /api/lazada/shops
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { cacheKeys, getCache, setCache } from "@/lib/cache";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const cacheKey = cacheKeys.lazada.shops(userId);
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const shops = await prisma.lazadaShop.findMany({
      where: { userId },
      select: {
        id: true,
        sellerId: true,
        sellerName: true,
        countryCode: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    await setCache(cacheKey, shops, 120);
    return NextResponse.json(shops);
  } catch (error) {
    logger.error("[Lazada Shops] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch shops" },
      { status: 500 },
    );
  }
}
