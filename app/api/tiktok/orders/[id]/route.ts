/**
 * TikTok Order Detail — Get order with items from local DB
 * GET /api/tiktok/orders/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";

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
    const userId = session.id;

    const order = await prisma.tikTokOrder.findFirst({
      where: { id, userId },
      include: {
        items: {
          include: {
            variant: {
              select: { id: true, sellerSku: true, tiktokSkuId: true },
            },
          },
        },
        shop: {
          select: { shopName: true, shopId: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    logger.error("[TikTok Order Detail] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order" },
      { status: 500 },
    );
  }
}
