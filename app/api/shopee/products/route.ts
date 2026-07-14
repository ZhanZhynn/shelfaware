/**
 * Shopee Products — List Products (from local DB)
 * GET /api/shopee/products
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { shopeeProductListQuerySchema } from "@/lib/validations/shopee";
import { getCache, setCache, cacheKeys } from "@/lib/cache/cache-utils";
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

    const query = {
      shopId: searchParams.get("shopId") || undefined,
      page: Number(searchParams.get("page") || 1),
      limit: Number(searchParams.get("limit") || 20),
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
    };

    const validationResult = shopeeProductListQuerySchema.safeParse(query);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters" },
        { status: 400 },
      );
    }

    const { shopId, page, limit, search, status } = validationResult.data;
    const skip = (page - 1) * limit;

    const cacheKey = cacheKeys.shopee.products(shopId || "all", { page, limit, search, status });
    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Record<string, unknown> = { userId };
    let lowStockThreshold = 10; // default
    // shopId from URL is the Shopee numeric ID — look up the ObjectId
    if (shopId) {
      const shop = await prisma.shopeeShop.findFirst({
        where: { shopId: Number(shopId), userId },
        select: { id: true, lowStockThreshold: true },
      });
      if (shop) {
        where.shopId = shop.id;
        lowStockThreshold = shop.lowStockThreshold;
      }
    }
    if (search) {
      where.OR = [
        { itemName: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    const [products, total] = await Promise.all([
      prisma.shopeeProduct.findMany({
        where,
        orderBy: { lastSyncedAt: "desc" },
        skip,
        take: limit,
        include: {
          variants: {
            select: {
              id: true,
              modelId: true,
              modelName: true,
              modelSku: true,
              price: true,
              originalPrice: true,
              stock: true,
              status: true,
              tierIndex: true,
            },
          },
        },
      }),
      prisma.shopeeProduct.count({ where }),
    ]);

    const result = { products, total, page, limit, lowStockThreshold };
    await setCache(cacheKey, result, 120);

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Shopee Products] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}
