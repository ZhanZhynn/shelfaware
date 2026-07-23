/**
 * Lazada Sync — Cron Handler
 * POST /api/lazada/sync/cron
 * Runs daily at 2 AM via Vercel cron.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/prisma/client";
import { setActiveSeller, syncLazadaAll, patchLazadaSDKEndpoint } from "@/lib/lazada";
import { logger } from "@/lib/logger";
import { invalidateAllServerCaches } from "@/lib/cache";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.error("[Lazada Cron] CRON_SECRET not configured");
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

    // Get all Lazada shops
    const shops = await prisma.lazadaShop.findMany({
      select: {
        id: true,
        sellerId: true,
        userId: true,
        sellerName: true,
        countryCode: true,
      },
    });

    if (shops.length === 0) {
      return NextResponse.json({ message: "No Lazada sellers connected", synced: 0 });
    }

    const results = [];
    for (const shop of shops) {
      try {
        setActiveSeller(shop.sellerId);
        patchLazadaSDKEndpoint(shop.countryCode);
        const result = await syncLazadaAll(shop.sellerId, shop.userId);
        results.push({
          sellerId: shop.sellerId,
          sellerName: shop.sellerName,
          ...result,
        });
      } catch (error) {
        logger.error(`[Lazada Cron] Sync failed for seller ${shop.sellerId}:`, error);
        results.push({
          sellerId: shop.sellerId,
          sellerName: shop.sellerName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void invalidateAllServerCaches();
    return NextResponse.json({
      message: `Synced ${shops.length} seller(s)`,
      results,
    });
  } catch (error) {
    logger.error("[Lazada Cron] Error:", error);
    return NextResponse.json(
      { error: "Cron job failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
