/**
 * TikTok Products — List products from local DB
 * GET /api/tiktok/products
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { tiktokProductListQuerySchema } from "@/lib/validations/tiktok";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const queryResult = tiktokProductListQuerySchema.safeParse({
      shopId: searchParams.get("shopId") || undefined,
      page: searchParams.get("page") || undefined,
      limit: searchParams.get("limit") || undefined,
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query", details: queryResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, page, limit, search, status } = queryResult.data;
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = { userId };
    if (shopId) {
      const shop = await prisma.tikTokShop.findFirst({
        where: { shopId, userId },
        select: { id: true },
      });
      if (shop) where.shopId = shop.id;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { tiktokProductId: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    const cacheKey = `tiktok:products:${shopId || "all"}:${page}:${limit}:${search || ""}:${status || ""}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [products, total] = await Promise.all([
      prisma.tikTokProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          variants: true,
        },
      }),
      prisma.tikTokProduct.count({ where }),
    ]);

    const result = {
      products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    await setCache(cacheKey, result, 120);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[TikTok Products] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}
