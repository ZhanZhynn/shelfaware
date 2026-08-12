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
  SHOPIFY_API_VERSION,
} from "./server";
import { fetchAllProducts, fetchAllOrders, fetchAllFinanceOrders } from "./graphql-client";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import { sanitizeMarketplaceRawPayload } from "@/lib/marketplace/json";
import { setMarketplaceCapability } from "@/lib/marketplace/analytics/capabilities";
import { areShopifyOrderLineItemsComplete, shopifyOrderLineSourceFacts } from "./order-line-facts";
import type { ShopifyOrderTransactionNode, ShopifyProductNode, ShopifyOrderNode, ShopifyRefundNode } from "./types";

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

function toExactMinorUnits(value: string): { amountMinor: string; amountScale: number } | null {
  const amount = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return null;

  const [, sign = "", whole = "", fraction = ""] = match;
  const digits = `${whole.replace(/^0+(?=\d)/, "")}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return { amountMinor: `${sign === "-" && digits !== "0" ? "-" : ""}${digits}`, amountScale: fraction.length };
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ─── Product Sync ─────────────────────────────────────────────────────────

export async function syncShopifyProducts(
  shopId: string,
  userId: string,
  actorId = userId,
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
      { shopId: shop.id, userId: actorId, channel: "shopify", syncType: "products" },
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
              compareAtPrice: variant.compareAtPrice
                ? parseMoney(variant.compareAtPrice)
                : null,
              currency: product.currencyCode,
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
  actorId = userId,
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
      { shopId: shop.id, userId: actorId, channel: "shopify", syncType: "orders" },
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
            select: {
              id: true,
              isLineItemsComplete: true,
              items: { select: { id: true }, take: 1 },
            },
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
            // This query has original/gross values but no verified current/refund reconciliation.
            financialQuality: "legacy-unverified",
            sourceObservedAt: new Date(),
            rawFinancialPayload: sanitizeMarketplaceRawPayload(order),
            isLineItemsComplete: areShopifyOrderLineItemsComplete(order.lineItems),
          };

          const lineItemsComplete = orderData.isLineItemsComplete;
          // Legacy orders predate the completeness flag. Existing line facts are still
          // authoritative enough to preserve rather than overwrite with a partial page.
          if (!lineItemsComplete && existing && (existing.isLineItemsComplete || existing.items.length > 0)) {
            const reason = order.lineItemsFetchError ?? "Shopify returned an incomplete line-item page";
            errors.push(`Order ${order.id}: line items incomplete; preserved prior complete snapshot; retry required: ${reason}`);
            logger.warn(`[Shopify Sync] Order ${order.id} line items incomplete; preserved prior complete snapshot`);
            continue;
          }

          await prisma.$transaction(async (tx) => {
            const dbOrder = existing
              ? await tx.shopifyOrder.update({ where: { id: existing.id }, data: orderData })
              : await tx.shopifyOrder.create({ data: { ...orderData, createdAt: new Date() } });

            // Only a complete source snapshot atomically replaces the prior item set.
            // An incomplete order without a known complete snapshot keeps no partial line facts.
            if (!lineItemsComplete) {
              await tx.shopifyOrderItem.deleteMany({ where: { orderId: dbOrder.id } });
              return;
            }

            await tx.shopifyOrderItem.deleteMany({ where: { orderId: dbOrder.id } });
            for (const item of order.lineItems.nodes) {
              const localVariant = item.variant?.id
                ? await tx.shopifyProductVariant.findFirst({
                    where: { shopifyVariantId: item.variant.id },
                    select: { id: true },
                  })
                : null;
              await tx.shopifyOrderItem.create({
                data: {
                  orderId: dbOrder.id,
                  shopId: shop.id,
                  variantId: localVariant?.id ?? null,
                  shopifyLineId: item.id,
                  ...shopifyOrderLineSourceFacts(item),
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
          });

          if (!lineItemsComplete) {
            const reason = order.lineItemsFetchError ?? "Shopify returned an incomplete line-item page";
            errors.push(`Order ${order.id}: line items incomplete; stored without line facts; retry required: ${reason}`);
          }

          synced++;
          if (existing) updated++;
          else created++;
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

// ─── Finance Sync ─────────────────────────────────────────────────────────

export async function syncShopifyFinance(
  shopId: string,
  userId: string,
  daysBack?: number,
  actorId = userId,
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  const shop = await prisma.shopifyShop.findFirst({ where: { id: shopId, userId } });
  if (!shop) throw new Error(`Shopify shop ${shopId} not found for user ${userId}`);

  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for Shopify shop ${shopId}`);
  }
  try {
    setActiveShop(shop.shopDomain);
    return await runWithSyncLog(
      { shopId: shop.id, userId: actorId, channel: "shopify", syncType: "finance" },
      async () => {
        try {
          const tokenCheck = await validateShopifyToken();
          if (!tokenCheck.valid) throw new Error(`Token validation failed: ${tokenCheck.error}`);

          const accessToken = await getActiveAccessToken();
          const updatedAfter = daysBack
            ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
            : undefined;
          const orders = await withShopifyRetry(() =>
            fetchAllFinanceOrders(shop.shopDomain, accessToken, updatedAfter),
          );
          const errors: string[] = [];
          let synced = 0;
          let created = 0;
          let updated = 0;

          const storeRecord = async (
            externalId: string,
            orderExternalId: string,
            transactionType: string,
            feeType: string,
            feeName: string | null,
            amount: { amount: string; currencyCode: string },
            occurredAt: string | null,
            rawPayload: unknown,
          ) => {
            const exactAmount = toExactMinorUnits(amount.amount);
            const data = {
              orderExternalId,
              transactionType,
              feeType,
              feeName,
              amountMinor: exactAmount?.amountMinor ?? null,
              amountScale: exactAmount?.amountScale ?? 2,
              amount: null,
              financialQuality: "unknown",
              unknownReason: exactAmount ? "source_observed_unverified" : "source_value_malformed",
              currency: amount.currencyCode,
              occurredAt: validDate(occurredAt),
              sourceObservedAt: new Date(),
              rawPayload: sanitizeMarketplaceRawPayload(rawPayload),
            };
            const where = {
              platform_shopId_externalId: { platform: "shopify", shopId: shop.id, externalId },
            };
            const existing = await prisma.marketplaceFinancialRecord.findUnique({ where, select: { id: true } });
            await prisma.marketplaceFinancialRecord.upsert({
              where,
              create: { userId, platform: "shopify", shopId: shop.id, externalId, ...data },
              update: data,
            });
            if (existing) updated++; else created++;
            synced++;
          };

          const storeTransaction = async (
            orderId: string,
            transaction: ShopifyOrderTransactionNode,
            refund?: ShopifyRefundNode,
          ) => storeRecord(
            transaction.id,
            orderId,
            transaction.kind,
            refund ? "refund_transaction" : "order_transaction",
            transaction.gateway,
            transaction.amountSet.shopMoney,
            transaction.processedAt ?? transaction.createdAt,
            refund
              ? { source: "refund_transaction", orderId, refundId: refund.id, refundCreatedAt: refund.createdAt, refundProcessedAt: refund.processedAt, transaction }
              : { source: "order_transaction", orderId, transaction },
          );

          for (const order of orders) {
            try {
              const refundTransactionIds = new Set<string>();
              for (const refund of order.refunds) {
                for (const transaction of refund.transactions.nodes) {
                  refundTransactionIds.add(transaction.id);
                  await storeTransaction(order.id, transaction, refund);
                }
                // A refund object alone does not confirm money moved; its
                // transaction rows above are the non-duplicated ledger facts.
              }
              for (const transaction of order.transactions.nodes) {
                if (!refundTransactionIds.has(transaction.id)) await storeTransaction(order.id, transaction);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              errors.push(`Order ${order.id}: ${message}`);
              logger.warn(`[Shopify Finance Sync] Failed to store finance records for order ${order.id}: ${message}`);
            }
          }

          await setMarketplaceCapability({
            userId,
            platform: "shopify",
            shopId: shop.id,
            capability: "finance",
            state: "available",
            endpointVersion: `Admin GraphQL API ${SHOPIFY_API_VERSION}`,
            observedFields: ["transactions.id", "transactions.amountSet", "refunds.id", "refunds.totalRefundedSet"],
          });
          return { synced, created, updated, errors };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await setMarketplaceCapability({
              userId,
              platform: "shopify",
              shopId: shop.id,
              capability: "finance",
              state: "failed",
              detail: message,
              endpointVersion: `Admin GraphQL API ${SHOPIFY_API_VERSION}`,
            });
          } catch (capabilityError) {
            logger.error("[Shopify Finance Sync] Failed to record finance capability:", capabilityError);
          }
          throw error;
        }
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
  actorId = userId,
): Promise<{
  products: Awaited<ReturnType<typeof syncShopifyProducts>>;
  orders: Awaited<ReturnType<typeof syncShopifyOrders>>;
}> {
  const products = await syncShopifyProducts(shopId, userId, actorId);
  const orders = await syncShopifyOrders(shopId, userId, undefined, actorId);
  return { products, orders };
}
