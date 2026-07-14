/**
 * Lazada Sync Logic
 * Handles product and order synchronization from Lazada to local database.
 * Uses lazada-api-client SDK with auto-pagination.
 * Uses runWithSyncLog for generic sync log lifecycle.
 */

import { getLazadaSDK, setActiveSeller, validateLazadaToken } from "./server";
import { getAllProductsCustom, getAllOrdersCustom, getMultipleOrderItemsCustom } from "./custom-api";
import prisma from "@/prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import type { LazadaOrderDetail } from "lazada-api-client";
import type { OrderItem } from "./custom-api";

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

  const shop = await prisma.lazadaShop.findFirst({
    where: { sellerId, userId },
  });
  if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId, channel: "lazada", syncType: "products" },
    async () => {
      const sdk = await getLazadaSDK();
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Validate token before attempting API calls
      const tokenCheck = await validateLazadaToken();
      if (!tokenCheck.valid) {
        throw new Error(
          `Lazada token is invalid or expired: ${tokenCheck.error}. ` +
          `Please re-authorize the seller by connecting again.`
        );
      }

      // Diagnostic: verify the SDK is hitting the correct endpoint
      const _require = eval("require") as NodeRequire;
      const { join } = _require("node:path") as typeof import("node:path");
      const constantPath = join(
        process.cwd(),
        "node_modules/lazada-api-client/dist/module/lazada/common/constant.js",
      );
      const constant = _require(constantPath) as { LZD_END_POINT: string };
      logger.info(
        `[Lazada Sync] SDK endpoint at call time: ${constant.LZD_END_POINT}`,
      );

      // Use custom getProducts implementation (SDK's version is broken - missing mandatory filter parameter)
      let products: Awaited<ReturnType<typeof getAllProductsCustom>>;
      try {
        // Fetch all products using custom implementation with proper API parameters
        products = await withLazadaRetry(() => getAllProductsCustom("live"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Lazada Sync] Custom getProducts failed: ${msg}`);
        throw err;
      }

      // Detect silent SDK failure: token is valid but got empty results
      // where we'd expect at least some products (only log, don't throw —
      // seller may genuinely have 0 products)
      if (products.length === 0) {
        logger.info(
          `[Lazada Sync] getProducts returned 0 results for seller ${sellerId}. ` +
          `Token is valid — seller may genuinely have no products, or the API returned an empty page.`
        );
      }

      for (const product of products) {
        try {
          const itemId = product.item_id;
          if (!itemId) continue;

          const sku = product.skus?.[0];
          const stock = sku?.quantity ?? 0;
          const price = parseFloat(String(sku?.price ?? 0));
          const status = product.status || "active";

          const existing = await prisma.lazadaProduct.findFirst({
            where: { shopId: shop.id, lazadaItemId: Number(itemId) },
          });

          if (existing) {
            await prisma.lazadaProduct.update({
              where: { id: existing.id },
              data: {
                itemName: product.attributes?.name || existing.itemName,
                status,
                price,
                specialPrice: sku?.special_price ? parseFloat(String(sku.special_price)) : null,
                stock: Number(stock),
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
                lazadaItemId: Number(itemId),
                itemName: product.attributes?.name || `Product ${itemId}`,
                sellerSku: sku?.SellerSku || null,
                primaryCategory: Number(product.primary_category),
                status,
                price,
                specialPrice: sku?.special_price ? parseFloat(String(sku.special_price)) : null,
                stock: Number(stock),
                imageUrl: product.images?.[0] || null,
                images: product.images || undefined,
                lastSyncedAt: new Date(),
              },
            });
            created++;
          }
          synced++;

          // Sync SKUs as variants
          if (product.skus && product.skus.length > 0) {
            const dbProduct = existing || (await prisma.lazadaProduct.findFirst({
              where: { shopId: shop.id, lazadaItemId: Number(itemId) },
            }));

            if (dbProduct) {
              for (const sku of product.skus) {
                if (!sku.SkuId) continue;

                const existingVariant = await prisma.lazadaProductVariant.findFirst({
                  where: { productId: dbProduct.id, skuId: sku.SkuId },
                });

                const variantData = {
                  sellerSku: sku.SellerSku || null,
                  shopSku: sku.ShopSku || null,
                  price: parseFloat(String(sku.price ?? 0)),
                  specialPrice: sku.special_price ? parseFloat(String(sku.special_price)) : null,
                  stock: sku.quantity ?? 0,
                  available: sku.Available ?? null,
                  status: sku.Status || "active",
                  images: sku.Images || undefined,
                  lastSyncedAt: new Date(),
                };

                if (existingVariant) {
                  await prisma.lazadaProductVariant.update({
                    where: { id: existingVariant.id },
                    data: variantData,
                  });
                } else {
                  await prisma.lazadaProductVariant.create({
                    data: {
                      productId: dbProduct.id,
                      shopId: shop.id,
                      userId,
                      lazadaItemId: Number(itemId),
                      skuId: sku.SkuId,
                      ...variantData,
                    },
                  });
                }
              }
            }
          }
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

  const shop = await prisma.lazadaShop.findFirst({
    where: { sellerId, userId },
  });
  if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId, channel: "lazada", syncType: "orders" },
    async () => {
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Validate token before attempting API calls
      const tokenCheck = await validateLazadaToken();
      if (!tokenCheck.valid) {
        throw new Error(
          `Lazada token is invalid or expired: ${tokenCheck.error}. ` +
          `Please re-authorize the seller by connecting again.`
        );
      }

      // Diagnostic: verify the SDK is hitting the correct endpoint
      const _require = eval("require") as NodeRequire;
      const { join } = _require("node:path") as typeof import("node:path");
      const constantPath = join(
        process.cwd(),
        "node_modules/lazada-api-client/dist/module/lazada/common/constant.js",
      );
      const constant = _require(constantPath) as { LZD_END_POINT: string };
      logger.info(
        `[Lazada Sync] SDK endpoint at order-sync call time: ${constant.LZD_END_POINT}`,
      );

      // Default to last 15 days if no date specified
      // Convert to ISO 8601 format without milliseconds (Lazada expects +0800, not Z)
      const after = createdAfter || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 15);
        const offset = -d.getTimezoneOffset();
        const sign = offset >= 0 ? "+" : "-";
        const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
        const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
        return d.toISOString().replace(/\.\d{3}Z$/, `${sign}${hours}${minutes}`);
      })();

      // Fetch all orders using custom implementation
      const orders = await withLazadaRetry(() =>
        getAllOrdersCustom({ created_after: after }),
      );

      // Batch fetch order items (max 50 IDs per request)
      const BATCH_SIZE = 50;
      const allItemMap = new Map<number, OrderItem[]>();

      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const orderIds = batch
          .map((o) => o.order_id)
          .filter((id): id is number => id != null);

        if (orderIds.length === 0) continue;

        try {
          const itemsList = await withLazadaRetry(() =>
            getMultipleOrderItemsCustom(orderIds),
          );
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
            orderNumber: order.order_number ? String(order.order_number) : null,
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
                  skuId: item.sku_id ? String(item.sku_id) : null,
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
