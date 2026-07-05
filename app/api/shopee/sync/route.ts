/**
 * Shopee Sync — Trigger Sync
 * POST /api/shopee/sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { setActiveShop, syncShopeeProducts, syncShopeeOrders, syncShopeeReturns, syncShopeeAll, isShopSyncing } from "@/lib/shopee";
import { shopeeSyncBodySchema } from "@/lib/validations/shopee";
import { prisma } from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    // Rate limit: strict (10/min) — sync is expensive
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const body = await request.json();

    const validationResult = shopeeSyncBodySchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, syncType } = validationResult.data;

    // Ownership check — verify the user owns this shop
    const shop = await prisma.shopeeShop.findFirst({
      where: { shopId, userId },
      select: { id: true },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Shop not found or you don't have access" },
        { status: 403 },
      );
    }

    // Check if sync is already in progress
    if (isShopSyncing(shopId)) {
      return NextResponse.json(
        { error: "Sync already in progress for this shop" },
        { status: 409 },
      );
    }

    logger.info(
      `[Shopee Sync] Triggered ${syncType} sync for shop ${shopId} by user ${userId}`,
    );

    // Set active shop for token resolution
    setActiveShop(shopId);

    let result: {
      products?: { synced: number; created: number; updated: number; errors: string[] };
      orders?: { synced: number; created: number; updated: number; errors: string[] };
      returns?: { synced: number; created: number; updated: number; errors: string[] };
    };

    switch (syncType) {
      case "products":
        result = { products: await syncShopeeProducts(shopId, userId) };
        break;
      case "orders":
        result = { orders: await syncShopeeOrders(shopId, userId) };
        break;
      case "returns":
        result = { returns: await syncShopeeReturns(shopId, userId) };
        break;
      case "all":
      default:
        result = await syncShopeeAll(shopId, userId);
        break;
    }

    // Invalidate cache after sync
    await invalidateCache(cacheKeys.shopee.pattern);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
