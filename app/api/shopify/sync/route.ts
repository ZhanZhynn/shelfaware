/**
 * Shopify Sync — Trigger Sync
 * POST /api/shopify/sync
 * Body: { shopId: string, syncType: "products"|"orders"|"all", daysBack?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { syncShopifyProducts, syncShopifyOrders, syncShopifyAll, isShopSyncing, validateShopifyToken, setActiveShop } from "@/lib/shopify";
import { shopifySyncBodySchema } from "@/lib/validations/shopify";
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

    const validationResult = shopifySyncBodySchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, syncType, daysBack } = validationResult.data;

    // Ownership check
    const shop = await prisma.shopifyShop.findFirst({
      where: { id: shopId, userId },
      select: { id: true, shopDomain: true },
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
      `[Shopify Sync] Triggered ${syncType} sync for shop ${shop.shopDomain} by user ${userId}`,
    );

    // Pre-flight token check (must set active shop so token validation targets the right shop)
    setActiveShop(shop.shopDomain);
    const tokenStatus = await validateShopifyToken();
    if (!tokenStatus.valid) {
      return NextResponse.json(
        {
          error: "Shopify token is invalid or expired",
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
        result = { products: await syncShopifyProducts(shopId, userId) };
        break;
      case "orders":
        result = { orders: await syncShopifyOrders(shopId, userId, daysBack) };
        break;
      case "all":
      default:
        result = await syncShopifyAll(shopId, userId);
        break;
    }

    // Invalidate cache after sync
    await invalidateCache("shopify:*");

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopify Sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
