/**
 * Lazada Sync Logs — List Sync History
 * GET /api/lazada/sync/logs
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);
    const sellerId = searchParams.get("sellerId");

    const cacheKey = cacheKeys.lazada.syncLogs(sellerId || "all");

    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Record<string, unknown> = { userId, channel: "lazada" };
    if (sellerId) {
      const shop = await prisma.lazadaShop.findFirst({
        where: { sellerId, userId },
        select: { id: true },
      });
      if (shop) where.shopId = shop.id;
    }

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    await setCache(cacheKey, logs, 120);

    return NextResponse.json(logs);
  } catch (error) {
    logger.error("[Lazada Sync Logs] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sync logs" },
      { status: 500 },
    );
  }
}
