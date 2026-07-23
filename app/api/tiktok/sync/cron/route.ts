/**
 * TikTok Shop Sync — Cron Handler
 * POST /api/tiktok/sync/cron
 * Runs daily via Vercel cron.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/prisma/client";
import { setActiveShop, syncTikTokAll } from "@/lib/tiktok";
import { logger } from "@/lib/logger";
import { invalidateAllServerCaches } from "@/lib/cache";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.error("[TikTok Cron] CRON_SECRET not configured");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    if (!authHeader) {
      return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const isValid = crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(cronSecret),
    );

    if (!isValid) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Get all TikTok shops
    const shops = await prisma.tikTokShop.findMany({
      select: {
        id: true,
        shopId: true,
        userId: true,
        shopName: true,
      },
    });

    if (shops.length === 0) {
      return NextResponse.json({ message: "No TikTok shops connected", synced: 0 });
    }

    const results = [];
    for (const shop of shops) {
      try {
        setActiveShop(shop.shopId);
        const result = await syncTikTokAll(shop.shopId, shop.userId);
        results.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          ...result,
        });
      } catch (error) {
        logger.error(`[TikTok Cron] Sync failed for shop ${shop.shopId}:`, error);
        results.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void invalidateAllServerCaches();
    return NextResponse.json({
      message: `Synced ${shops.length} shop(s)`,
      results,
    });
  } catch (error) {
    logger.error("[TikTok Cron] Error:", error);
    return NextResponse.json(
      { error: "Cron job failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
