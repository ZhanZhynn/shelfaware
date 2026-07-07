/**
 * Lazada Sync — Trigger Sync
 * POST /api/lazada/sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { setActiveSeller, syncLazadaProducts, syncLazadaOrders, syncLazadaAll, isSellerSyncing } from "@/lib/lazada";
import { lazadaSyncBodySchema } from "@/lib/validations/lazada";
import prisma from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = lazadaSyncBodySchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { sellerId, syncType } = validationResult.data;

    // Ownership check
    const shop = await prisma.lazadaShop.findFirst({
      where: { sellerId, userId },
      select: { id: true },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Seller not found or you don't have access" },
        { status: 403 },
      );
    }

    if (isSellerSyncing(sellerId)) {
      return NextResponse.json(
        { error: "Sync already in progress for this seller" },
        { status: 409 },
      );
    }

    logger.info(
      `[Lazada Sync] Triggered ${syncType} sync for seller ${sellerId} by user ${userId}`,
    );

    setActiveSeller(sellerId);

    let result: {
      products?: { synced: number; created: number; updated: number; errors: string[] };
      orders?: { synced: number; created: number; updated: number; errors: string[] };
    };

    switch (syncType) {
      case "products":
        result = { products: await syncLazadaProducts(sellerId, userId) };
        break;
      case "orders":
        result = { orders: await syncLazadaOrders(sellerId, userId) };
        break;
      case "all":
      default:
        result = await syncLazadaAll(sellerId, userId);
        break;
    }

    // Invalidate cache after sync
    await invalidateCache(cacheKeys.lazada?.pattern || "lazada:*");

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Lazada Sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
