/**
 * TikTok Shop Sync — Trigger Sync
 * POST /api/tiktok/sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { setActiveShop, syncTikTokProducts, syncTikTokOrders, syncTikTokAll, isShopSyncing, validateTikTokToken } from "@/lib/tiktok";
import { tiktokSyncBodySchema } from "@/lib/validations/tiktok";
import prisma from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateCache } from "@/lib/cache/cache-utils";
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

    const validationResult = tiktokSyncBodySchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, syncType } = validationResult.data;

    // Ownership check
    const shop = await prisma.tikTokShop.findFirst({
      where: { shopId, userId },
      select: { id: true },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Shop not found or you don't have access" },
        { status: 403 },
      );
    }

    if (isShopSyncing(shopId)) {
      return NextResponse.json(
        { error: "Sync already in progress for this shop" },
        { status: 409 },
      );
    }

    logger.info(
      `[TikTok Sync] Triggered ${syncType} sync for shop ${shopId} by user ${userId}`,
    );

    setActiveShop(shopId);

    // Pre-flight token check
    const tokenStatus = await validateTikTokToken();
    if (!tokenStatus.valid) {
      return NextResponse.json(
        {
          error: "TikTok token is invalid or expired",
          details: tokenStatus.error,
          action: "Please re-authorize the shop by connecting again.",
        },
        { status: 401 },
      );
    }

    let result: {
      products?: { synced: number; created: number; updated: number; errors: string[] };
      orders?: { synced: number; created: number; updated: number; errors: string[] };
    };

    switch (syncType) {
      case "products":
        result = { products: await syncTikTokProducts(shopId, userId) };
        break;
      case "orders":
        result = { orders: await syncTikTokOrders(shopId, userId) };
        break;
      case "all":
      default:
        result = await syncTikTokAll(shopId, userId);
        break;
    }

    // Invalidate cache after sync
    await invalidateCache("tiktok:*");

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[TikTok Sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
