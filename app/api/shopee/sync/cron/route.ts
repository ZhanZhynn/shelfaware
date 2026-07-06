/**
 * Shopee Sync — Cron Job Endpoint
 * POST /api/shopee/sync/cron
 * Called by Vercel cron scheduler daily at 2 AM.
 * Syncs all connected Shopee shops.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/prisma/client";
import { setActiveShop, syncShopeeAll, syncShopeeAds, isShopSyncing } from "@/lib/shopee";
import { invalidateCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Reject immediately if CRON_SECRET is not configured
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // Timing-safe secret comparison
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader.length !== expected.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(authHeader),
      Buffer.from(expected),
    );

    if (!isValid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all connected shops
    const shops = await prisma.shopeeShop.findMany({
      select: { id: true, shopId: true, userId: true, shopName: true },
    });

    if (shops.length === 0) {
      logger.info("[Shopee Cron] No connected shops found, skipping sync");
      return NextResponse.json({ message: "No shops to sync", synced: 0 });
    }

    logger.info(`[Shopee Cron] Starting daily sync for ${shops.length} shops`);

    const results: { shopId: number; shopName: string; success: boolean; error?: string }[] = [];

    // Sync each shop sequentially to avoid rate limits
    for (const shop of shops) {
      // Skip shops already being synced
      if (isShopSyncing(shop.shopId)) {
        logger.info(`[Shopee Cron] Skipping shop ${shop.shopName} (${shop.shopId}) — sync already in progress`);
        results.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          success: false,
          error: "Sync already in progress",
        });
        continue;
      }

      try {
        setActiveShop(shop.shopId);
        await syncShopeeAll(shop.shopId, shop.userId);
        // Sync ads after products+orders (separate to avoid one failure blocking the other)
        try {
          await syncShopeeAds(shop.shopId, shop.userId, 30);
        } catch (adsError) {
          logger.error(`[Shopee Cron] Ads sync failed for ${shop.shopName}:`, adsError);
        }
        results.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          success: true,
        });
        logger.info(`[Shopee Cron] Shop ${shop.shopName} (${shop.shopId}) synced successfully`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          success: false,
          error: errorMsg,
        });
        logger.error(`[Shopee Cron] Shop ${shop.shopName} (${shop.shopId}) sync failed:`, error);
      }
    }

    // Invalidate all Shopee caches
    await invalidateCache(cacheKeys.shopee.pattern);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(`[Shopee Cron] Daily sync complete: ${succeeded} succeeded, ${failed} failed`);

    return NextResponse.json({
      message: "Daily sync complete",
      total: shops.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    logger.error("[Shopee Cron] Unexpected error:", error);
    return NextResponse.json(
      { error: "Cron job failed" },
      { status: 500 },
    );
  }
}
