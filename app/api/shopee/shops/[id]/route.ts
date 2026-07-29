/**
 * Shopee Shop — Get/Disconnect Shop
 * GET /api/shopee/shops/[id]
 * DELETE /api/shopee/shops/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { invalidateCache, cacheKeys } from "@/lib/cache/cache-utils";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ownerIds = await marketplaceOwnerIds(session);

    const shop = await prisma.shopeeShop.findFirst({
      where: { id, userId: { in: ownerIds } },
      select: {
        id: true,
        shopId: true,
        shopName: true,
        shopStatus: true,
        region: true,
        merchantId: true,
        isCb: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });

    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    return NextResponse.json(shop);
  } catch (error) {
    logger.error("[Shopee Shop] Error fetching shop:", error);
    return NextResponse.json(
      { error: "Failed to fetch shop" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ownerIds = await marketplaceOwnerIds(session);

    const shop = await prisma.shopeeShop.findFirst({
      where: { id, userId: { in: ownerIds } },
    });

    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    // Delete related records first (cascade should handle this, but be explicit)
    await prisma.shopeeOrderItem.deleteMany({
      where: { order: { shopId: shop.id } },
    });
    await prisma.shopeeOrder.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopeeProduct.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopeeSyncLog.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopeeShop.delete({ where: { id: shop.id } });

    // Invalidate cache
    await invalidateCache(cacheKeys.shopee.pattern);

    logger.info(
      `[Shopee Shop] Shop ${shop.shopId} disconnected for user ${session.id}`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[Shopee Shop] Error disconnecting shop:", error);
    return NextResponse.json(
      { error: "Failed to disconnect shop" },
      { status: 500 },
    );
  }
}
