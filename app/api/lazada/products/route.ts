/**
 * Lazada Products — List products from local DB
 * GET /api/lazada/products
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { cacheKeys, getCache, setCache } from "@/lib/cache";
import { lazadaProductListQuerySchema } from "@/lib/validations/lazada";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const queryResult = lazadaProductListQuerySchema.safeParse({
      sellerId: searchParams.get("sellerId") || undefined,
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

    const { sellerId, page, limit, search, status } = queryResult.data;
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = { userId };
    if (sellerId) {
      const shop = await prisma.lazadaShop.findFirst({
        where: { sellerId, userId },
        select: { id: true },
      });
      if (shop) where.shopId = shop.id;
    }
    if (search) {
      where.OR = [
        { itemName: { contains: search, mode: "insensitive" } },
        { sellerSku: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    const cacheKey = cacheKeys.lazada.products(sellerId || "all", { page, limit, search, status });
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [products, total] = await Promise.all([
      prisma.lazadaProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          variants: {
            select: {
              id: true,
              skuId: true,
              sellerSku: true,
              shopSku: true,
              variation: true,
              price: true,
              specialPrice: true,
              stock: true,
              available: true,
              status: true,
              images: true,
            },
          },
        },
      }),
      prisma.lazadaProduct.count({ where }),
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
    logger.error("[Lazada Products] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}
