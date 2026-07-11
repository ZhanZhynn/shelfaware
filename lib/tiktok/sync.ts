/**
 * TikTok Shop Sync Orchestration
 * Handles product and order synchronization from TikTok Shop to local database.
 * Uses custom fetch-based API client (no SDK dependency).
 * Uses runWithSyncLog for generic sync log lifecycle.
 */

import {
  setActiveShop,
  validateTikTokToken,
  ensureFreshToken,
  getActiveShopCipher,
} from "./server";
import {
  searchProducts,
  getProductDetail,
  searchOrders,
  getOrderDetail,
} from "./custom-api";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import type {
  TikTokProductSummary,
  TikTokOrderSummary,
  TikTokProductSKU,
} from "./types";

// ─── Status Mappings ──────────────────────────────────────────────────────

const ORDER_STATUS_MAP: Record<string, string> = {
  UNPAID: "pending",
  ON_HOLD: "confirmed",
  AWAITING_SHIPMENT: "confirmed",
  PARTIALLY_SHIPPING: "processing",
  AWAITING_COLLECTION: "processing",
  IN_TRANSIT: "shipped",
  DELIVERED: "delivered",
  COMPLETED: "delivered",
  CANCELLED: "cancelled",
};

const PAYMENT_STATUS_MAP: Record<string, string> = {
  UNPAID: "unpaid",
  ON_HOLD: "paid",
  AWAITING_SHIPMENT: "paid",
  PARTIALLY_SHIPPING: "paid",
  AWAITING_COLLECTION: "paid",
  IN_TRANSIT: "paid",
  DELIVERED: "paid",
  COMPLETED: "paid",
  CANCELLED: "refunded",
};

const PRODUCT_STATUS_MAP: Record<string, string> = {
  ACTIVATE: "active",
  DEACTIVATE: "inactive",
  UNDER_REVIEW: "pending",
  FAILED: "rejected",
  FROZEN: "inactive",
  DRAFT: "draft",
};

// ─── Sync Lock (per-shop mutex) ───────────────────────────────────────────

const syncLocks = new Set<string>();

function acquireSyncLock(shopId: string): boolean {
  if (syncLocks.has(shopId)) return false;
  syncLocks.add(shopId);
  return true;
}

function releaseSyncLock(shopId: string): void {
  syncLocks.delete(shopId);
}

export function isShopSyncing(shopId: string): boolean {
  return syncLocks.has(shopId);
}

// ─── Retry wrapper ────────────────────────────────────────────────────────

function withTikTokRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    retries: 3,
    match: /rate_limit|too_many_requests|429|throttle/i,
    baseDelayMs: 3000,
    label: "TikTok",
  });
}

// ─── Product Sync ─────────────────────────────────────────────────────────

/**
 * Sync all products from a TikTok Shop.
 * Paginates using next_page_token, upserts products + variants.
 */
export async function syncTikTokProducts(
  shopId: string,
  userId: string,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  setActiveShop(shopId);

  const shop = await prisma.tikTokShop.findFirst({
    where: { shopId, userId },
  });
  if (!shop) throw new Error(`TikTok shop ${shopId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId, channel: "tiktok", syncType: "products" },
    async () => {
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Validate token
      const tokenCheck = await validateTikTokToken();
      if (!tokenCheck.valid) {
        throw new Error(
          `TikTok token is invalid: ${tokenCheck.error}. Please re-authorize the shop.`,
        );
      }

      const accessToken = await ensureFreshToken();
      const cipher = await getActiveShopCipher();

      // Fetch all products using pagination
      let pageToken: string | undefined;

      while (true) {
        const data = await withTikTokRetry(() =>
          searchProducts(accessToken, cipher, {}, 50, pageToken),
        );

        const products = data.products ?? [];

        if (products.length > 0 && synced === 0) {
          const first = products[0];
          if (first) {
            logger.info(`[TikTok Sync] First product keys: ${JSON.stringify(Object.keys(first))}, product_id=${(first as any).product_id}, id=${(first as any).id}`);
          }
        }

        for (const product of products) {
          try {
            const productId = product.product_id || product.id;
            if (!productId) continue;

            const existing = await prisma.tikTokProduct.findFirst({
              where: { shopId: shop.id, tiktokProductId: productId },
            });

            const productData = {
              title: product.title || "Untitled",
              status: PRODUCT_STATUS_MAP[product.status] || product.status,
              auditStatus: product.audit?.status || product.audit_status || null,
              hasDraft: product.has_draft ?? false,
              mainImageUrl: product.main_image_url || null,
              lastSyncedAt: new Date(),
            };

            if (existing) {
              await prisma.tikTokProduct.update({
                where: { id: existing.id },
                data: productData,
              });
              updated++;
            } else {
              await prisma.tikTokProduct.create({
                data: {
                  shopId: shop.id,
                  userId,
                  tiktokProductId: productId,
                  categoryId: product.category_id || null,
                  createdBy: userId,
                  ...productData,
                },
              });
              created++;
            }

            // Sync SKUs as variants
            if (product.skus && product.skus.length > 0) {
              const dbProduct = existing || (await prisma.tikTokProduct.findFirst({
                where: { shopId: shop.id, tiktokProductId: productId },
              }));

              if (dbProduct) {
                for (const sku of product.skus) {
                  if (!sku.id) continue;

                  const existingVariant = await prisma.tikTokProductVariant.findFirst({
                    where: { productId: dbProduct.id, tiktokSkuId: sku.id },
                  });

                  const variantData = {
                    sellerSku: sku.seller_sku || null,
                    price: parseFloat(sku.sku_price?.price || "0"),
                    originalPrice: sku.sku_price?.original_price
                      ? parseFloat(sku.sku_price.original_price)
                      : null,
                    currency: sku.sku_price?.currency || null,
                    totalQuantity: sku.inventory?.total_quantity ?? 0,
                    imageUrl: sku.image_url || null,
                    status: sku.status || "NORMAL",
                    salesAttrs: sku.sales_attrs ? JSON.parse(JSON.stringify(sku.sales_attrs)) : undefined,
                    lastSyncedAt: new Date(),
                  };

                  if (existingVariant) {
                    await prisma.tikTokProductVariant.update({
                      where: { id: existingVariant.id },
                      data: variantData,
                    });
                  } else {
                    await prisma.tikTokProductVariant.create({
                      data: {
                        productId: dbProduct.id,
                        shopId: shop.id,
                        userId,
                        tiktokSkuId: sku.id,
                        createdBy: userId,
                        ...variantData,
                      },
                    });
                  }
                }
              }
            }

            synced++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const pid = product.product_id || (product as any).id || "unknown";
            errors.push(`Product ${pid}: ${msg}`);
            logger.warn(`[TikTok Sync] Failed to sync product ${pid}: ${msg}`);
          }
        }

        pageToken = data.next_page_token || undefined;
        if (!pageToken) break;
      }

      // Update shop last synced
      await prisma.tikTokShop.update({
        where: { id: shop.id },
        data: { lastSyncedAt: new Date() },
      });

      return { synced, created, updated, errors };
    },
  );
}

// ─── Order Sync ───────────────────────────────────────────────────────────

/**
 * Sync orders from a TikTok Shop.
 * Paginates using next_page_token, then batch-fetches order details.
 */
export async function syncTikTokOrders(
  shopId: string,
  userId: string,
  createdAfter?: number,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  setActiveShop(shopId);

  const shop = await prisma.tikTokShop.findFirst({
    where: { shopId, userId },
  });
  if (!shop) throw new Error(`TikTok shop ${shopId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId, channel: "tiktok", syncType: "orders" },
    async () => {
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Validate token
      const tokenCheck = await validateTikTokToken();
      if (!tokenCheck.valid) {
        throw new Error(
          `TikTok token is invalid: ${tokenCheck.error}. Please re-authorize the shop.`,
        );
      }

      const accessToken = await ensureFreshToken();
      const cipher = await getActiveShopCipher();

      // Default to last 15 days if no date specified
      const createTimeFrom = createdAfter || Math.floor(Date.now() / 1000) - 15 * 24 * 60 * 60;

      // Collect all order IDs from search
      const allOrderIds: string[] = [];
      let pageToken: string | undefined;

      while (true) {
        const data = await withTikTokRetry(() =>
          searchOrders(
            accessToken,
            cipher,
            { create_time_ge: createTimeFrom },
            50,
            pageToken,
            "create_time",
            "DESC",
          ),
        );

        const orders = data.orders ?? [];

        if (orders.length > 0 && allOrderIds.length === 0) {
          const first = orders[0];
          if (first) {
            logger.info(`[TikTok Sync] First order keys: ${JSON.stringify(Object.keys(first))}, id=${(first as any).id}`);
          }
        }

        for (const order of orders) {
          if (order.id) {
            allOrderIds.push(order.id);
          }
        }

        pageToken = data.next_page_token || undefined;
        if (!pageToken) break;
      }

      // Batch fetch order details (max 50 per request)
      const BATCH_SIZE = 50;

      for (let i = 0; i < allOrderIds.length; i += BATCH_SIZE) {
        const batch = allOrderIds.slice(i, i + BATCH_SIZE);

        try {
          const detailData = await withTikTokRetry(() =>
            getOrderDetail(accessToken, cipher, batch),
          );

          const orderList = detailData.orders ?? [];

          for (const order of orderList) {
            try {
              if (!order.id) continue;

              const orderStatus = ORDER_STATUS_MAP[order.status] || "pending";
              const paymentStatus = PAYMENT_STATUS_MAP[order.status] || "unpaid";

              const existing = await prisma.tikTokOrder.findFirst({
                where: { tiktokOrderId: order.id },
              });

              const orderData = {
                orderStatus,
                cancelReason: order.cancel_reason || null,
                trackingNumber: order.tracking_number || null,
                shippingProvider: order.shipping_provider || null,
                fulfillmentType: order.fulfillment_type || null,
                shippingType: order.shipping_type || null,
                payment: order.payment ? JSON.parse(JSON.stringify(order.payment)) : undefined,
                recipientAddress: order.recipient_address
                  ? JSON.parse(JSON.stringify(order.recipient_address))
                  : undefined,
                isCod: order.is_cod ?? false,
                buyerUserId: order.user_id || null,
                buyerEmail: order.buyer_email || null,
                buyerNickname: order.buyer_nickname || null,
                tiktokCreatedAt: order.create_time ? new Date(order.create_time * 1000) : null,
                tiktokUpdatedAt: order.update_time ? new Date(order.update_time * 1000) : null,
                paidTime: order.paid_time ? new Date(order.paid_time * 1000) : null,
                cancelTime: order.cancel_time ? new Date(order.cancel_time * 1000) : null,
                deliveryTime: order.delivery_time ? new Date(order.delivery_time * 1000) : null,
              };

              if (existing) {
                await prisma.tikTokOrder.update({
                  where: { id: existing.id },
                  data: { ...orderData, updatedAt: new Date() },
                });
                updated++;
              } else {
                await prisma.tikTokOrder.create({
                  data: {
                    shopId: shop.id,
                    userId,
                    tiktokOrderId: order.id,
                    ...orderData,
                  },
                });
                created++;
              }

              // Upsert order items
              const dbOrder = existing || (await prisma.tikTokOrder.findFirst({
                where: { tiktokOrderId: order.id },
              }));

              if (dbOrder && order.line_items) {
                // Delete existing items and re-create
                await prisma.tikTokOrderItem.deleteMany({
                  where: { orderId: dbOrder.id },
                });

                // Build variant lookup map for linking
                const variantMap = new Map<string, string>();
                for (const item of order.line_items) {
                  if (item.sku_id) {
                    const variant = await prisma.tikTokProductVariant.findFirst({
                      where: { tiktokSkuId: item.sku_id },
                      select: { id: true },
                    });
                    if (variant) {
                      variantMap.set(item.sku_id, variant.id);
                    }
                  }
                }

                for (const item of order.line_items) {
                  await prisma.tikTokOrderItem.create({
                    data: {
                      orderId: dbOrder.id,
                      shopId: shop.id,
                      variantId: item.sku_id ? variantMap.get(item.sku_id) || null : null,
                      tiktokOrderLineItemId: item.id || "",
                      productId: item.product_id || null,
                      skuId: item.sku_id || null,
                      productName: item.product_name || "Unknown Product",
                      skuName: item.sku_name || null,
                      sellerSku: item.seller_sku || null,
                      productImageUrl: item.sku_image || null,
                      quantity: 1,
                      originalPrice: parseFloat(item.original_price || "0"),
                      price: parseFloat(item.sale_price || "0"),
                      discount: item.seller_discount ? parseFloat(item.seller_discount) : 0,
                      subtotalAmount: 0,
                      taxAmount: 0,
                      refundAmount: 0,
                      isGift: item.is_gift ?? false,
                      saleAttrs: undefined,
                    },
                  });
                }
              }

              synced++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`Order ${order.id}: ${msg}`);
              logger.warn(`[TikTok Sync] Failed to sync order ${order.id}: ${msg}`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Batch ${i}-${i + BATCH_SIZE}: ${msg}`);
          logger.warn(`[TikTok Sync] Failed to batch fetch orders: ${msg}`);
        }
      }

      // Update shop last synced
      await prisma.tikTokShop.update({
        where: { id: shop.id },
        data: { lastSyncedAt: new Date() },
      });

      return { synced, created, updated, errors };
    },
  );
}

// ─── Full Sync (with lock) ────────────────────────────────────────────────

/**
 * Full sync — products + orders.
 * Acquires a per-shop lock to prevent concurrent syncs.
 */
export async function syncTikTokAll(
  shopId: string,
  userId: string,
): Promise<{
  products: { synced: number; created: number; updated: number; errors: string[] };
  orders: { synced: number; created: number; updated: number; errors: string[] };
}> {
  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for TikTok shop ${shopId}`);
  }

  try {
    const [products, orders] = await Promise.all([
      syncTikTokProducts(shopId, userId),
      syncTikTokOrders(shopId, userId),
    ]);

    return { products, orders };
  } finally {
    releaseSyncLock(shopId);
  }
}
