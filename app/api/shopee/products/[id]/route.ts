/**
 * Shopee Product — Get Product Detail
 * GET /api/shopee/products/[id]
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

    const cacheKey = `${cacheKeys.shopee.productDetail(id)}:${marketplaceCacheScope(session)}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const product = await prisma.shopeeProduct.findFirst({
      where: { id, userId: { in: ownerIds } },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await setCache(cacheKey, product, 300);

    return NextResponse.json(product);
  } catch (error) {
    logger.error("[Shopee Product] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 },
    );
  }
}
