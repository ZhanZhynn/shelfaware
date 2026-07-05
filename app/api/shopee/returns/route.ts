/**
 * Shopee Returns — List & Detail
 * GET /api/shopee/returns — list returns with pagination & filters
 * GET /api/shopee/returns?id=xxx — single return detail
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get("shopId");
    const returnId = searchParams.get("id");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 20)));

    const shopWhere: Record<string, unknown> = { userId };
    if (shopId) shopWhere.shopId = shopId;

    const shops = await prisma.shopeeShop.findMany({
      where: shopWhere,
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    if (shopIds.length === 0) {
      return NextResponse.json({ returns: [], total: 0, page, limit });
    }

    // Single return detail
    if (returnId) {
      const cacheKey = `shopee:return:${returnId}`;
      const cached = await getCache(cacheKey);
      if (cached) return NextResponse.json(cached);

      const returnDetail = await prisma.shopeeReturn.findFirst({
        where: { id: returnId, shopId: { in: shopIds } },
      });

      if (!returnDetail) {
        return NextResponse.json({ error: "Return not found" }, { status: 404 });
      }

      await setCache(cacheKey, returnDetail, 120);
      return NextResponse.json(returnDetail);
    }

    // List returns
    const where: Record<string, unknown> = { shopId: { in: shopIds } };
    if (status) where.status = status;

    const cacheKey = `shopee:returns:${shopId || "all"}:${status || "all"}:${page}:${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const skip = (page - 1) * limit;

    const [returns, total] = await Promise.all([
      prisma.shopeeReturn.findMany({
        where,
        orderBy: { shopeeCreatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.shopeeReturn.count({ where }),
    ]);

    const result = { returns, total, page, limit };
    await setCache(cacheKey, result, 120);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Returns] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch returns" },
      { status: 500 },
    );
  }
}
