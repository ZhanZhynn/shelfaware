/**
 * Shopee Webhook — Receive push events from Shopee
 * POST /api/shopee/webhook
 *
 * Shopee sends events when:
 * - Order status changes (order_status_updated)
 * - Product stock changes (item_updated)
 * - Product info changes (item_updated)
 *
 * Webhook registration is done in Shopee Seller Center → Settings → Notification
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { invalidateCache } from "@/lib/cache/cache-utils";
import { verifyHmacSha256Hex } from "@/lib/auth/hmac-utils";

export const runtime = "nodejs";

interface ShopeeWebhookPayload {
  code: string;
  message: string;
  data: {
    shop_id: number;
    order_sn?: string;
    order_status?: string;
    item_id?: number;
    stock_change?: number;
    event_type: string;
    update_time: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-shopee-signature");

    // Verify webhook signature
    if (!verifyHmacSha256Hex(rawBody, signature, process.env.SHOPEE_PARTNER_KEY)) {
      logger.warn("[Shopee Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: ShopeeWebhookPayload = JSON.parse(rawBody);
    const { data } = payload;

    logger.info(`[Shopee Webhook] Received event: ${data.event_type} for shop ${data.shop_id}`);

    // Find the shop
    const shop = await prisma.shopeeShop.findFirst({
      where: { shopId: data.shop_id },
    });

    if (!shop) {
      logger.warn(`[Shopee Webhook] Shop not found: ${data.shop_id}`);
      return NextResponse.json({ received: true });
    }

    switch (data.event_type) {
      case "order_status_updated":
        await handleOrderStatusUpdate(shop.id, data);
        break;

      case "item_updated":
      case "item_stock_changed":
        await handleItemUpdate(shop.id, data);
        break;

      case "return_status_updated":
        await handleReturnStatusUpdate(shop.id, data);
        break;

      default:
        logger.info(`[Shopee Webhook] Unhandled event type: ${data.event_type}`);
    }

    // Invalidate related caches
    await Promise.all([
      invalidateCache(`shopee:stats:*`),
      invalidateCache(`shopee:orders:*`),
      invalidateCache(`shopee:products:*`),
      invalidateCache(`shopee:revenue-trend:*`),
      invalidateCache(`shopee:buyers:*`),
      invalidateCache(`shopee:product-performance:*`),
      invalidateCache(`shopee:profit:*`),
      invalidateCache(`shopee:returns:*`),
      invalidateCache(`shopee:returns-stats:*`),
    ]);

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("[Shopee Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}

async function handleOrderStatusUpdate(
  shopId: string,
  data: ShopeeWebhookPayload["data"],
) {
  if (!data.order_sn || !data.order_status) return;

  try {
    const existing = await prisma.shopeeOrder.findFirst({
      where: { shopeeOrderId: data.order_sn },
    });

    if (existing) {
      await prisma.shopeeOrder.update({
        where: { id: existing.id },
        data: {
          orderStatus: data.order_status,
          shopeeUpdatedAt: new Date(data.update_time * 1000),
          lastSyncedAt: new Date(),
        },
      });
      logger.info(`[Shopee Webhook] Order ${data.order_sn} status → ${data.order_status}`);
    } else {
      logger.info(`[Shopee Webhook] Order ${data.order_sn} not found locally, will be synced on next cron`);
    }
  } catch (error) {
    logger.error(`[Shopee Webhook] Failed to update order ${data.order_sn}:`, error);
  }
}

async function handleItemUpdate(
  shopId: string,
  data: ShopeeWebhookPayload["data"],
) {
  if (!data.item_id) return;

  try {
    const existing = await prisma.shopeeProduct.findFirst({
      where: {
        shopId,
        shopeeItemId: data.item_id,
      },
    });

    if (existing) {
      const updateData: Record<string, unknown> = {
        lastSyncedAt: new Date(),
      };

      // If stock changed, update stock
      if (data.stock_change !== undefined) {
        // Stock change is relative, but we don't know the new absolute value
        // The full sync will correct this. For now, log it.
        logger.info(`[Shopee Webhook] Item ${data.item_id} stock changed by ${data.stock_change}`);
      }

      await prisma.shopeeProduct.update({
        where: { id: existing.id },
        data: updateData,
      });
      logger.info(`[Shopee Webhook] Item ${data.item_id} updated`);
    } else {
      logger.info(`[Shopee Webhook] Item ${data.item_id} not found locally, will be synced on next cron`);
    }
  } catch (error) {
    logger.error(`[Shopee Webhook] Failed to update item ${data.item_id}:`, error);
  }
}

/**
 * GET /api/shopee/webhook — Health check for webhook verification
 * Shopee may send a GET request to verify the webhook URL
 */
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}

async function handleReturnStatusUpdate(
  shopId: string,
  data: ShopeeWebhookPayload["data"],
) {
  if (!data.order_sn) return;

  try {
    // Find the return by order_sn
    const existing = await prisma.shopeeReturn.findFirst({
      where: {
        shopId,
        orderSn: data.order_sn,
      },
    });

    if (existing) {
      await prisma.shopeeReturn.update({
        where: { id: existing.id },
        data: {
          status: data.order_status || existing.status,
          shopeeUpdatedAt: new Date(data.update_time * 1000),
          updatedAt: new Date(),
        },
      });
      logger.info(`[Shopee Webhook] Return for order ${data.order_sn} status → ${data.order_status}`);
    } else {
      logger.info(`[Shopee Webhook] Return for order ${data.order_sn} not found locally, will be synced on next cron`);
    }
  } catch (error) {
    logger.error(`[Shopee Webhook] Failed to update return for order ${data.order_sn}:`, error);
  }
}
