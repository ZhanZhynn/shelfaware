/**
 * Shopify Products — List products from local DB
 * GET /api/shopify/products?shopId=...&page=1&limit=20&search=...&status=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { shopifyProductListQuerySchema } from "@/lib/validations/shopify";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const queryParams = {
      shopId: searchParams.get("shopId") || undefined,
      page: searchParams.get("page") || "1",
      limit: searchParams.get("limit") || "20",
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
    };

    const validationResult = shopifyProductListQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, page, limit, search, status } = validationResult.data;

    // Verify shop ownership if shopId provided
    if (shopId) {
      const shop = await prisma.shopifyShop.findFirst({
        where: { id: shopId, userId },
        select: { id: true },
      });
      if (!shop) {
        return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      }
    }

    const where: Record<string, unknown> = { userId };
    if (shopId) where.shopId = shopId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { handle: { contains: search, mode: "insensitive" } },
        { vendor: { contains: search, mode: "insensitive" } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.shopifyProduct.findMany({
        where,
        include: {
          variants: {
            select: {
              id: true,
              title: true,
              displayName: true,
              sku: true,
              barcode: true,
              price: true,
              compareAtPrice: true,
              inventoryQuantity: true,
              inventoryPolicy: true,
              position: true,
              availableForSale: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shopifyProduct.count({ where }),
    ]);

    return NextResponse.json({
      products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error("[Shopify Products] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}
