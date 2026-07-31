/**
 * Lazada Sync — Trigger Sync
 * POST /api/lazada/sync
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { setActiveSeller, syncLazadaProducts, syncLazadaOrders, syncLazadaFinance, syncLazadaAll, isSellerSyncing, validateLazadaToken, patchLazadaSDKEndpoint } from "@/lib/lazada";
import { lazadaSyncBodySchema } from "@/lib/validations/lazada";
import prisma from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateCache, cacheKeys, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const ownerIds = await marketplaceOwnerIds(session);
    const body = await request.json();

    const validationResult = lazadaSyncBodySchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { sellerId, syncType } = validationResult.data;

    const shop = await prisma.lazadaShop.findFirst({
      where: { sellerId, userId: { in: ownerIds } },
      select: { id: true, userId: true, countryCode: true },
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
    patchLazadaSDKEndpoint(shop.countryCode);

    // Pre-flight token check — fail fast with a clear message
    if (syncType !== "finance") {
      const tokenStatus = await validateLazadaToken();
      if (!tokenStatus.valid) {
        return NextResponse.json(
          {
            error: "Lazada token is invalid or expired",
            details: tokenStatus.error,
            action: "Please re-authorize the seller by connecting again.",
          },
          { status: 401 },
        );
      }
    }

    let result: {
      products?: { synced: number; created: number; updated: number; errors: string[] };
      orders?: { synced: number; created: number; updated: number; errors: string[] };
      finance?: { synced: number; created: number; updated: number; errors: string[] };
    };

    switch (syncType) {
      case "products":
        result = { products: await syncLazadaProducts(sellerId, shop.userId, userId) };
        break;
      case "orders":
        result = { orders: await syncLazadaOrders(sellerId, shop.userId, undefined, userId) };
        break;
      case "finance":
        result = { finance: await syncLazadaFinance(sellerId, shop.userId, undefined, userId) };
        break;
      case "all":
      default:
        result = await syncLazadaAll(sellerId, shop.userId, userId);
        break;
    }

    // Invalidate cache after sync
    await invalidateCache(cacheKeys.lazada?.pattern || "lazada:*");
    await invalidateMarketplaceAnalytics("lazada");

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Lazada Sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
