/**
 * Shopee Order — Get Order Detail
 * GET /api/shopee/orders/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { marketplaceCacheScope, marketplaceOwnerIds } from "@/lib/marketplace/access";

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

    const cacheKey = `${cacheKeys.shopee.orderDetail(id)}:${marketplaceCacheScope(session)}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const order = await prisma.shopeeOrder.findFirst({
      where: { id, userId: { in: ownerIds } },
      include: { items: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await setCache(cacheKey, order, 300);

    return NextResponse.json(order);
  } catch (error) {
    logger.error("[Shopee Order] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order" },
      { status: 500 },
    );
  }
}
