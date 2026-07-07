/**
 * Lazada Sync Logic
 * Handles product and order synchronization from Lazada to local database.
 * Uses lazada-api-client SDK with auto-pagination.
 * Uses runWithSyncLog for generic sync log lifecycle.
 */

import { getLazadaSDK, setActiveSeller } from "./server";
import prisma from "@/prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import type { LazadaOrderDetail, OrderItem } from "lazada-api-client";

// Lazada order status mapping to our internal status
const ORDER_STATUS_MAP: Record<string, string> = {
  pending: "pending",
  confirmed: "confirmed",
  packed: "processing",
  ready_to_ship: "processing",
  shipped: "shipped",
  delivered: "delivered",
  canceled: "cancelled",
  cancelled: "cancelled",
  returned: "returned",
  failed: "cancelled",
};

const PAYMENT_STATUS_MAP: Record<string, string> = {
  pending: "unpaid",
  confirmed: "paid",
  packed: "paid",
  ready_to_ship: "paid",
  shipped: "paid",
  delivered: "paid",
  canceled: "refunded",
  cancelled: "refunded",
  returned: "refunded",
  failed: "unpaid",
};

// ─── Sync Lock (per-seller mutex) ─────────────────────────────────────────

const syncLocks = new Set<string>();

function acquireSyncLock(sellerId: string): boolean {
  if (syncLocks.has(sellerId)) return false;
  syncLocks.add(sellerId);
  return true;
}

function releaseSyncLock(sellerId: string): void {
  syncLocks.delete(sellerId);
}

export function isSellerSyncing(sellerId: string): boolean {
  return syncLocks.has(sellerId);
}

// ─── Retry wrapper for Lazada API calls ───────────────────────────────────

function withLazadaRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    retries: 3,
    match: /SellerCallLimit|rate_limit|too_many_requests|429/i,
    baseDelayMs: 3000,
    label: "Lazada",
  });
}

// ─── Product Sync ─────────────────────────────────────────────────────────

/**
 * Sync all products from a Lazada seller.
 * Uses SDK's getProducts() which auto-paginates.
 */
export async function syncLazadaProducts(
  sellerId: string,
  userId: string,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  setActiveSeller(sellerId);

  return runWithSyncLog(
    { shopId: sellerId, userId, channel: "lazada", syncType: "products" },
    async () => {
      const sdk = await getLazadaSDK();
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Find our LazadaShop record
      const shop = await prisma.lazadaShop.findFirst({
        where: { sellerId, userId },
      });
      if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

      // Fetch all products (auto-paginated by SDK)
      const products = await withLazadaRetry(() => sdk.getProducts());

      for (const product of products) {
        try {
          const itemId = product.item_id;
          if (!itemId) continue;

          const sku = product.skus?.[0];
          const stock = sku?.quantity ?? 0;
          const price = sku?.price ?? 0;
          const status = product.status || "active";

          const existing = await prisma.lazadaProduct.findFirst({
            where: { shopId: shop.id, lazadaItemId: itemId },
          });

          if (existing) {
            await prisma.lazadaProduct.update({
              where: { id: existing.id },
              data: {
                itemName: product.attributes?.name || existing.itemName,
                status,
                price,
                specialPrice: sku?.special_price || null,
                stock,
                imageUrl: product.images?.[0] || existing.imageUrl,
                images: product.images || existing.images,
                lastSyncedAt: new Date(),
              },
            });
            updated++;
          } else {
            await prisma.lazadaProduct.create({
              data: {
                shopId: shop.id,
                userId,
                lazadaItemId: itemId,
                itemName: product.attributes?.name || `Product ${itemId}`,
                sellerSku: sku?.SellerSku || null,
                primaryCategory: product.primary_category,
                status,
                price,
                specialPrice: sku?.special_price || null,
                stock,
                imageUrl: product.images?.[0] || null,
                images: product.images || undefined,
                lastSyncedAt: new Date(),
              },
            });
            created++;
          }
          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Product ${product.item_id}: ${msg}`);
          logger.warn(`[Lazada Sync] Failed to sync product ${product.item_id}: ${msg}`);
        }
      }

      // Update shop last synced
      await prisma.lazadaShop.update({
        where: { id: shop.id },
        data: { lastSyncedAt: new Date() },
      });

      return { synced, created, updated, errors };
    },
  );
}

// ─── Order Sync ───────────────────────────────────────────────────────────

/**
 * Sync orders from a Lazada seller.
 * Uses SDK's getAllOrders() which auto-paginates, then fetches items per order.
 */
export async function syncLazadaOrders(
  sellerId: string,
  userId: string,
  createdAfter?: string,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  setActiveSeller(sellerId);

  return runWithSyncLog(
    { shopId: sellerId, userId, channel: "lazada", syncType: "orders" },
    async () => {
      const sdk = await getLazadaSDK();
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      const shop = await prisma.lazadaShop.findFirst({
        where: { sellerId, userId },
      });
      if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

      // Default to last 15 days if no date specified
      const after = createdAfter || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 15);
        return d.toISOString();
      })();

      // Fetch all orders (auto-paginated by SDK)
      const orders = await withLazadaRetry(() =>
        sdk.getAllOrders({ created_after: after }),
      );

      // Batch fetch order items (SDK getMultipleOrderItems accepts max 50 IDs)
      const BATCH_SIZE = 50;
      const allItemMap = new Map<number, OrderItem[]>();

      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const orderIds = batch
          .map((o) => o.order_id)
          .filter((id): id is number => id != null);

        if (orderIds.length === 0) continue;

        try {
          const result = await withLazadaRetry(() =>
            sdk.getMultipleOrderItems(orderIds.join(",")),
          );
          const itemsList = Array.isArray(result.data) ? result.data : [];
          for (const entry of itemsList) {
            if (entry.order_id && entry.order_items) {
              allItemMap.set(entry.order_id, entry.order_items);
            }
          }
        } catch (err) {
          logger.warn(`[Lazada Sync] Failed to batch fetch order items: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Process each order
      for (const order of orders) {
        try {
          const orderId = order.order_id;
          if (!orderId) continue;

          const orderItems = allItemMap.get(orderId) || [];
          const orderStatus = (order.statuses?.[0] || "pending").toLowerCase();
          const internalStatus = ORDER_STATUS_MAP[orderStatus] || "pending";
          const paymentStatus = PAYMENT_STATUS_MAP[orderStatus] || "unpaid";

          const totalAmount = parseFloat(order.price || "0");
          const shippingFee = parseFloat(order.shipping_fee || "0");

          const existing = await prisma.lazadaOrder.findFirst({
            where: { lazadaOrderId: String(orderId) },
          });

          const orderData = {
            orderNumber: order.order_number,
            orderStatus: internalStatus,
            paymentStatus,
            totalAmount,
            shippingFee,
            currency: "MYR", // Default; Lazada doesn't always return currency
            customerFirstName: order.customer_first_name || null,
            customerLastName: order.customer_last_name || null,
            paymentMethod: order.payment_method || null,
            remarks: order.remarks || null,
            trackingNumber: orderItems[0]?.tracking_number || null,
            trackingCarrier: orderItems[0]?.shipment_provider || null,
            shippingAddress: order.address_shipping ? JSON.parse(JSON.stringify(order.address_shipping)) as Prisma.InputJsonValue : undefined,
            billingAddress: order.address_billing ? JSON.parse(JSON.stringify(order.address_billing)) as Prisma.InputJsonValue : undefined,
            lazadaCreatedAt: order.created_at ? new Date(order.created_at) : null,
            lazadaUpdatedAt: order.updated_at ? new Date(order.updated_at) : null,
          };

          if (existing) {
            await prisma.lazadaOrder.update({
              where: { id: existing.id },
              data: { ...orderData, updatedAt: new Date() },
            });
            updated++;
          } else {
            await prisma.lazadaOrder.create({
              data: {
                shopId: shop.id,
                userId,
                lazadaOrderId: String(orderId),
                ...orderData,
              },
            });
            created++;
          }

          // Upsert order items
          const dbOrder = existing || (await prisma.lazadaOrder.findFirst({
            where: { lazadaOrderId: String(orderId) },
          }));

          if (dbOrder) {
            // Delete existing items and re-create (simpler than diffing)
            await prisma.lazadaOrderItem.deleteMany({
              where: { orderId: dbOrder.id },
            });

            for (const item of orderItems) {
              const itemStatus = (item.status || orderStatus).toLowerCase();
              await prisma.lazadaOrderItem.create({
                data: {
                  orderId: dbOrder.id,
                  shopId: shop.id,
                  lazadaOrderItemId: item.order_item_id || 0,
                  itemId: item.item_id || null,
                  skuId: item.sku_id || null,
                  sellerSku: item.seller_sku || null,
                  shopSku: item.shop_sku || null,
                  productName: item.name || "Unknown Product",
                  variation: item.variation || null,
                  quantity: 1, // Lazada items are typically qty 1 per line
                  price: parseFloat(item.item_price || "0"),
                  paidPrice: parseFloat(item.paid_price || "0"),
                  itemPrice: parseFloat(item.item_price || "0"),
                  currency: item.currency || "MYR",
                  status: ORDER_STATUS_MAP[itemStatus] || internalStatus,
                  shipmentProvider: item.shipment_provider || null,
                  trackingNumber: item.tracking_number || null,
                },
              });
            }
          }

          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Order ${order.order_id}: ${msg}`);
          logger.warn(`[Lazada Sync] Failed to sync order ${order.order_id}: ${msg}`);
        }
      }

      // Update shop last synced
      await prisma.lazadaShop.update({
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
 * Acquires a per-seller lock to prevent concurrent syncs.
 */
export async function syncLazadaAll(
  sellerId: string,
  userId: string,
): Promise<{
  products: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
  orders: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
}> {
  if (!acquireSyncLock(sellerId)) {
    throw new Error(`Sync already in progress for seller ${sellerId}`);
  }

  try {
    const [products, orders] = await Promise.all([
      syncLazadaProducts(sellerId, userId),
      syncLazadaOrders(sellerId, userId),
    ]);

    return { products, orders };
  } finally {
    releaseSyncLock(sellerId);
  }
}
