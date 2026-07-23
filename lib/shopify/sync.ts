/**
 * Shopify Sync Orchestration
 * Handles product and order synchronization from Shopify to local database.
 * Uses cursor-based GraphQL pagination.
 * Uses runWithSyncLog for generic sync log lifecycle.
 */

import {
  setActiveShop,
  validateShopifyToken,
  getActiveAccessToken,
} from "./server";
import { fetchAllProducts, fetchAllOrders } from "./graphql-client";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import type { ShopifyProductNode, ShopifyOrderNode } from "./types";

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

function withShopifyRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    retries: 3,
    match: /rate_limit|too_many_requests|429|throttle/i,
    baseDelayMs: 3000,
    label: "Shopify",
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a Money scalar (string) to float. Returns 0 if invalid.
 */
function parseMoney(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Derive a human-readable order status from Shopify fields.
 */
function deriveOrderStatus(order: ShopifyOrderNode): string {
  if (order.cancelledAt) return "cancelled";
  if (order.closed) return "closed";
  return "open";
}

/**
 * Extract the numeric ID from a GraphQL GID (e.g. "gid://shopify/Product/123" → "123").
 */
function extractIdFromGid(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

// ─── Product Sync ─────────────────────────────────────────────────────────

export async function syncShopifyProducts(
  shopId: string,
  userId: string,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const shop = await prisma.shopifyShop.findFirst({
    where: { id: shopId, userId },
  });
  if (!shop) throw new Error(`Shopify shop ${shopId} not found for user ${userId}`);

  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for Shopify shop ${shopId}`);
  }
  try {
    setActiveShop(shop.shopDomain);

    return await runWithSyncLog(
      { shopId: shop.id, userId, channel: "shopify", syncType: "products" },
      async () => {
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Pre-flight token check
      const tokenCheck = await validateShopifyToken();
      if (!tokenCheck.valid) {
        throw new Error(`Token validation failed: ${tokenCheck.error}`);
      }

      const accessToken = await getActiveAccessToken();
      const products = await withShopifyRetry(() => fetchAllProducts(shop.shopDomain, accessToken));

      logger.info(`[Shopify Sync] Fetched ${products.length} products from ${shop.shopDomain}`);

      for (const product of products) {
        try {
          const existing = await prisma.shopifyProduct.findFirst({
            where: { shopId: shop.id, shopifyProductId: product.id },
          });

          const productData = {
            shopId: shop.id,
            userId,
            shopifyProductId: product.id,
            title: product.title,
            handle: product.handle,
            description: product.description,
            vendor: product.vendor,
            productType: product.productType,
            status: product.status,
            tags: product.tags,
            totalInventory: product.totalInventory,
            tracksInventory: product.tracksInventory,
            featuredImageUrl: product.featuredImage?.url ?? null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          };

          let dbProduct;
          if (existing) {
            dbProduct = await prisma.shopifyProduct.update({
              where: { id: existing.id },
              data: productData,
            });
            updated++;
          } else {
            dbProduct = await prisma.shopifyProduct.create({
              data: { ...productData, createdAt: new Date() },
            });
            created++;
          }

          // Sync variants
          for (const variant of product.variants.nodes) {
            const existingVariant = await prisma.shopifyProductVariant.findFirst({
              where: { productId: dbProduct.id, shopifyVariantId: variant.id },
            });

            const variantData = {
              productId: dbProduct.id,
              shopifyVariantId: variant.id,
              title: variant.title,
              displayName: variant.displayName,
              sku: variant.sku,
              barcode: variant.barcode,
              price: parseMoney(variant.price),
              compareAtPrice: variant.compareAtPrice ? parseMoney(variant.compareAtPrice) : null,
              inventoryQuantity: variant.inventoryQuantity ?? 0,
              inventoryPolicy: variant.inventoryPolicy,
              position: variant.position,
              availableForSale: variant.availableForSale,
              updatedAt: new Date(),
            };

            if (existingVariant) {
              await prisma.shopifyProductVariant.update({
                where: { id: existingVariant.id },
                data: variantData,
              });
            } else {
              await prisma.shopifyProductVariant.create({
                data: { ...variantData, createdAt: new Date() },
              });
            }
          }

          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Product ${product.id}: ${msg}`);
          logger.warn(`[Shopify Sync] Failed to sync product ${product.id}: ${msg}`);
        }
      }

      // Update shop lastSyncedAt
      await prisma.shopifyShop.update({
        where: { id: shop.id },
        data: { lastSyncedAt: new Date() },
      });

      return { synced, created, updated, errors };
      },
    );
  } finally {
    releaseSyncLock(shopId);
  }
}

// ─── Order Sync ───────────────────────────────────────────────────────────

export async function syncShopifyOrders(
  shopId: string,
  userId: string,
  daysBack?: number,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const shop = await prisma.shopifyShop.findFirst({
    where: { id: shopId, userId },
  });
  if (!shop) throw new Error(`Shopify shop ${shopId} not found for user ${userId}`);

  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for Shopify shop ${shopId}`);
  }
  try {
    setActiveShop(shop.shopDomain);

    return await runWithSyncLog(
      { shopId: shop.id, userId, channel: "shopify", syncType: "orders" },
      async () => {
      const errors: string[] = [];
      let synced = 0;
      let created = 0;
      let updated = 0;

      // Pre-flight token check
      const tokenCheck = await validateShopifyToken();
      if (!tokenCheck.valid) {
        throw new Error(`Token validation failed: ${tokenCheck.error}`);
      }

      const accessToken = await getActiveAccessToken();
      const createdAfter = daysBack
        ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      const orders = await withShopifyRetry(() =>
        fetchAllOrders(shop.shopDomain, accessToken, createdAfter),
      );

      logger.info(`[Shopify Sync] Fetched ${orders.length} orders from ${shop.shopDomain}`);

      for (const order of orders) {
        try {
          const existing = await prisma.shopifyOrder.findFirst({
            where: { shopId: shop.id, shopifyOrderId: order.id },
          });

          const orderData = {
            shopId: shop.id,
            userId,
            shopifyOrderId: order.id,
            orderName: order.name,
            orderStatus: deriveOrderStatus(order),
            financialStatus: order.displayFinancialStatus,
            fulfillmentStatus: order.displayFulfillmentStatus,
            totalAmount: parseMoney(order.totalPriceSet.shopMoney.amount),
            subtotalAmount: parseMoney(order.subtotalPriceSet.shopMoney.amount),
            shippingAmount: parseMoney(order.totalShippingPriceSet.shopMoney.amount),
            taxAmount: order.totalTaxSet ? parseMoney(order.totalTaxSet.shopMoney.amount) : null,
            currency: order.currencyCode,
            test: order.test,
            confirmed: order.confirmed,
            note: order.note,
            tags: order.tags,
            customerEmail: order.customer?.email ?? order.email,
            customerFirstName: order.customer?.firstName ?? null,
            customerLastName: order.customer?.lastName ?? null,
            shippingAddress: order.shippingAddress ?? null,
            cancelReason: order.cancelReason,
            shopifyCreatedAt: new Date(order.createdAt),
            shopifyUpdatedAt: new Date(order.updatedAt),
            processedAt: new Date(order.processedAt),
            closedAt: order.closedAt ? new Date(order.closedAt) : null,
            cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          };

          let dbOrder;
          if (existing) {
            dbOrder = await prisma.shopifyOrder.update({
              where: { id: existing.id },
              data: orderData,
            });
            updated++;
          } else {
            dbOrder = await prisma.shopifyOrder.create({
              data: { ...orderData, createdAt: new Date() },
            });
            created++;
          }

          // Delete and recreate line items (simpler than diffing)
          await prisma.shopifyOrderItem.deleteMany({
            where: { orderId: dbOrder.id },
          });

          for (const item of order.lineItems.nodes) {
            // Find local variant by shopifyVariantId
            let variantId: string | null = null;
            if (item.variant?.id) {
              const localVariant = await prisma.shopifyProductVariant.findFirst({
                where: { shopifyVariantId: item.variant.id },
                select: { id: true },
              });
              variantId = localVariant?.id ?? null;
            }

            await prisma.shopifyOrderItem.create({
              data: {
                orderId: dbOrder.id,
                shopId: shop.id,
                variantId,
                shopifyLineId: item.id,
                name: item.name,
                title: item.title,
                quantity: item.quantity,
                currentQuantity: item.currentQuantity,
                unfulfilledQuantity: item.unfulfilledQuantity,
                sku: item.sku,
                price: parseMoney(item.originalUnitPriceSet.shopMoney.amount),
                discountedPrice: parseMoney(item.discountedUnitPriceSet.shopMoney.amount),
                currency: item.originalUnitPriceSet.shopMoney.currencyCode,
                createdAt: new Date(),
              },
            });
          }

          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Order ${order.id}: ${msg}`);
          logger.warn(`[Shopify Sync] Failed to sync order ${order.id}: ${msg}`);
        }
      }

      // Update shop lastSyncedAt
      await prisma.shopifyShop.update({
        where: { id: shop.id },
        data: { lastSyncedAt: new Date() },
      });

      return { synced, created, updated, errors };
      },
    );
  } finally {
    releaseSyncLock(shopId);
  }
}

// ─── Full Sync ────────────────────────────────────────────────────────────

export async function syncShopifyAll(
  shopId: string,
  userId: string,
): Promise<{
  products: Awaited<ReturnType<typeof syncShopifyProducts>>;
  orders: Awaited<ReturnType<typeof syncShopifyOrders>>;
}> {
  const products = await syncShopifyProducts(shopId, userId);
  const orders = await syncShopifyOrders(shopId, userId);
  return { products, orders };
}
