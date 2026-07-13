/**
 * Shopify Orders — List orders from local DB
 * GET /api/shopify/orders?shopId=...&page=1&limit=20&status=...&createdAfter=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { shopifyOrderListQuerySchema } from "@/lib/validations/shopify";
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
      status: searchParams.get("status") || undefined,
      createdAfter: searchParams.get("createdAfter") || undefined,
    };

    const validationResult = shopifyOrderListQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { shopId, page, limit, status, createdAfter } = validationResult.data;

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
    if (status) where.orderStatus = status;
    if (createdAfter) {
      where.shopifyCreatedAt = { gte: new Date(createdAfter) };
    }

    const [orders, total] = await Promise.all([
      prisma.shopifyOrder.findMany({
        where,
        include: {
          items: {
            select: {
              id: true,
              name: true,
              quantity: true,
              currentQuantity: true,
              price: true,
              sku: true,
            },
          },
        },
        orderBy: { shopifyCreatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shopifyOrder.count({ where }),
    ]);

    return NextResponse.json({
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error("[Shopify Orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}
