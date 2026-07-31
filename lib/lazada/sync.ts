/**
 * Lazada Sync Logic
 * Handles product and order synchronization from Lazada to local database.
 * Uses lazada-api-client SDK with auto-pagination.
 * Uses runWithSyncLog for generic sync log lifecycle.
 */

import { getLazadaSDK, setActiveSeller, validateLazadaToken } from "./server";
import { getAllFinanceTransactionDetailsCustom, getAllLogisticsFeeDetailCustom, getAllProductsCustom, getAllOrdersCustom, getMultipleOrderItemsCustom, getPayoutStatusCustom } from "./custom-api";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { runWithSyncLog } from "@/lib/sync/run-with-sync-log";
import { withRetry } from "@/lib/api/retry";
import { parseSourceNumber } from "@/lib/marketplace/analytics/provenance";
import { sanitizeMarketplaceRawPayload, toInputJson } from "@/lib/marketplace/json";
import { setMarketplaceCapability } from "@/lib/marketplace/analytics/capabilities";
import { invalidateLazadaStatementReconciliations } from "@/lib/server/lazada-reconciliation";
import { createHash } from "crypto";
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
  actorId = userId,
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
    { shopId: shop.id, userId: actorId, channel: "lazada", syncType: "products" },
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
  actorId = userId,
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
    { shopId: shop.id, userId: actorId, channel: "lazada", syncType: "orders" },
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

          const totalAmount = parseSourceNumber(order.price, "lazada.order.price").value;
          const shippingFee = parseSourceNumber(order.shipping_fee, "lazada.order.shipping_fee").value;
          const itemCurrencies = [...new Set(orderItems
            .map((item) => item.currency?.trim().toUpperCase())
            .filter((currency): currency is string => Boolean(currency)))];
          // Lazada omits currency on the order, but its line items provide it.
          // Persist it only when every priced item agrees on one upstream currency.
          const currency = itemCurrencies.length === 1 ? itemCurrencies[0] : null;

          const existing = await prisma.lazadaOrder.findFirst({
            where: { shopId: shop.id, lazadaOrderId: String(orderId) },
          });

          const orderData = {
            orderNumber: order.order_number ? String(order.order_number) : null,
            orderStatus: internalStatus,
            paymentStatus,
            totalAmount,
            shippingFee,
            currency,
            customerFirstName: order.customer_first_name || null,
            customerLastName: order.customer_last_name || null,
            paymentMethod: order.payment_method || null,
            remarks: order.remarks || null,
            trackingNumber: orderItems[0]?.tracking_code || orderItems[0]?.tracking_number || null,
            trackingCarrier: orderItems[0]?.shipment_provider || null,
            shippingAddress: order.address_shipping ? toInputJson(order.address_shipping) : undefined,
            billingAddress: order.address_billing ? toInputJson(order.address_billing) : undefined,
            lazadaCreatedAt: order.created_at ? new Date(order.created_at) : null,
            lazadaUpdatedAt: order.updated_at ? new Date(order.updated_at) : null,
            financialQuality: "unknown",
            financialRevision: "source-v1",
            qualityMarkedAt: new Date(),
            sourceObservedAt: new Date(),
            rawFinancialPayload: sanitizeMarketplaceRawPayload(order),
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
             where: { shopId: shop.id, lazadaOrderId: String(orderId) },
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
                   // Row multiplicity has not been verified. Do not manufacture unit sales.
                   quantity: null,
                   price: parseSourceNumber(item.item_price, "lazada.item.item_price").value,
                   paidPrice: parseSourceNumber(item.paid_price, "lazada.item.paid_price").value,
                   itemPrice: parseSourceNumber(item.item_price, "lazada.item.item_price").value,
                  currency: item.currency || null,
                  status: ORDER_STATUS_MAP[itemStatus] || internalStatus,
                  shipmentProvider: item.shipment_provider || null,
                   trackingNumber: item.tracking_code || item.tracking_number || null,
                    financialQuality: "unknown",
                    financialRevision: "source-v1",
                    qualityMarkedAt: new Date(),
                    sourceObservedAt: new Date(),
                     rawFinancialPayload: sanitizeMarketplaceRawPayload(item),
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

// ─── Finance Sync ─────────────────────────────────────────────────────────

function toExactMinorUnits(value: unknown): { amountMinor: string; amountScale: number } | null {
  // Only source strings preserve decimal precision; a JavaScript number may not.
  if (typeof value !== "string") return null;
  const amount = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return null;

  const [, sign = "", whole = "", fraction = ""] = match;
  const digits = `${whole.replace(/^0+(?=\d)/, "")}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return { amountMinor: `${sign === "-" && digits !== "0" ? "-" : ""}${digits}`, amountScale: fraction.length };
}

function financeExternalId(transaction: Record<string, unknown>): string {
  if (typeof transaction.transaction_number === "string" && transaction.transaction_number) {
    return transaction.transaction_number;
  }
  // The documented transaction_number is the stable provider key. Hash the full
  // row only for malformed rows where Lazada omitted it, preserving idempotency.
  return `row:${createHash("sha256").update(JSON.stringify(transaction)).digest("hex")}`;
}

function documentedStatementReference(value: unknown): string | null {
  // Lazada documents `statement` for finance rows and `statement_number` for payouts.
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`).join(",")}}`;
}

function financeSourceChanged(existing: object, data: object): boolean {
  const fields = ["statementExternalId", "orderExternalId", "itemExternalId", "transactionType", "feeType", "feeName", "amountMinor", "amountScale", "financialQuality", "unknownReason", "currency", "occurredAt", "rawPayload"];
  const current = existing as Record<string, unknown>;
  const incoming = data as Record<string, unknown>;
  return fields.some((field) => stableValue(current[field]) !== stableValue(incoming[field]));
}

function defaultFinanceStart(): Date {
  const start = new Date();
  start.setDate(start.getDate() - 15);
  return start;
}

function parsePayoutAmount(value: unknown): { amountMinor: string; amountScale: number; currency: string | null } | null {
  // Lazada may append an ISO currency code (for example, "3962.41 EUR").
  // Parse the original string so no precision is lost through a JS number.
  if (typeof value !== "string") return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:\s+([A-Za-z]{3}))?$/.exec(value.trim());
  if (!match) return null;

  const [, sign = "", whole = "", fraction = "", currency] = match;
  const digits = `${whole.replace(/^0+(?=\d)/, "")}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return {
    amountMinor: `${sign === "-" && digits !== "0" ? "-" : ""}${digits}`,
    amountScale: fraction.length,
    currency: currency?.toUpperCase() ?? null,
  };
}

function payoutExternalId(statement: Record<string, unknown>): string {
  const statementNumber = typeof statement.statement_number === "string" ? statement.statement_number.trim() : "";
  if (statementNumber) return `payout:${statementNumber}`;
  return `payout:row:${createHash("sha256").update(JSON.stringify(statement)).digest("hex")}`;
}

function isPaidPayout(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function syncLazadaFinance(
  sellerId: string,
  userId: string,
  createdAfter?: string,
  actorId = userId,
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  setActiveSeller(sellerId);

  const shop = await prisma.lazadaShop.findFirst({ where: { sellerId, userId } });
  if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId: actorId, channel: "lazada", syncType: "finance" },
    async () => {
      try {
        const tokenCheck = await validateLazadaToken();
        if (!tokenCheck.valid) {
          throw new Error(`Lazada token is invalid or expired: ${tokenCheck.error}. Please re-authorize the seller by connecting again.`);
        }

        const transactions = await withLazadaRetry(() => getAllFinanceTransactionDetailsCustom({
          start_time: createdAfter || defaultFinanceStart(),
          end_time: new Date(),
        }));
        let created = 0;
        let updated = 0;
        const errors: string[] = [];

        for (const transaction of transactions) {
          try {
            const externalId = financeExternalId(transaction);
            const parsedAmount = parseSourceNumber(transaction.amount, "lazada.finance.amount");
            const exactAmount = toExactMinorUnits(transaction.amount);
            const occurredAt = transaction.transaction_date ? new Date(transaction.transaction_date) : null;
            const data = {
              statementExternalId: documentedStatementReference(transaction.statement),
              orderExternalId: typeof transaction.order_no === "string" ? transaction.order_no : null,
              itemExternalId: typeof transaction.orderItem_no === "string" ? transaction.orderItem_no : null,
              transactionType: typeof transaction.transaction_type === "string" ? transaction.transaction_type : null,
              feeType: typeof transaction.fee_type === "string" ? transaction.fee_type : null,
              feeName: typeof transaction.fee_name === "string" ? transaction.fee_name : null,
              amountMinor: exactAmount?.amountMinor ?? null,
              amountScale: exactAmount?.amountScale ?? 2,
              amount: null,
              financialQuality: parsedAmount.quality,
              unknownReason: parsedAmount.unknownReason,
              sourceObservedAt: new Date(),
              occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
              rawPayload: sanitizeMarketplaceRawPayload(transaction),
            };
            const existing = await prisma.marketplaceFinancialRecord.findUnique({
              where: { platform_shopId_externalId: { platform: "lazada", shopId: shop.id, externalId } },
              select: { id: true, statementExternalId: true, orderExternalId: true, itemExternalId: true, transactionType: true, feeType: true, feeName: true, amountMinor: true, amountScale: true, financialQuality: true, unknownReason: true, currency: true, occurredAt: true, rawPayload: true },
            });
            await prisma.marketplaceFinancialRecord.upsert({
              where: { platform_shopId_externalId: { platform: "lazada", shopId: shop.id, externalId } },
              create: { userId, platform: "lazada", shopId: shop.id, externalId, ...data },
              update: data,
            });
            if (existing) {
              updated++;
              if (financeSourceChanged(existing, data)) {
                await invalidateLazadaStatementReconciliations({ userId, shopId: shop.id, statementExternalIds: [existing.statementExternalId, data.statementExternalId] });
              }
            } else created++;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Transaction ${String(transaction.transaction_number ?? "unknown")}: ${message}`);
            logger.warn(`[Lazada Finance Sync] Failed to store transaction: ${message}`);
          }
        }

        await setMarketplaceCapability({
          userId,
          platform: "lazada",
          shopId: shop.id,
          capability: "finance",
          state: "available",
          endpointVersion: "/finance/transaction/details/get",
          observedFields: ["transaction_number", "amount", "transaction_date"],
        });

        // Also sync logistics fee details for shipping discrepancy detection
        try {
          await syncLazadaLogisticsFees(sellerId, userId, createdAfter, actorId);
        } catch (logisticsError) {
          const msg = logisticsError instanceof Error ? logisticsError.message : String(logisticsError);
          logger.warn(`[Lazada Finance Sync] Logistics fee sync failed (non-blocking): ${msg}`);
        }

        return { synced: transactions.length, created, updated, errors };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await setMarketplaceCapability({
            userId,
            platform: "lazada",
            shopId: shop.id,
            capability: "finance",
            state: "failed",
            detail: message,
            endpointVersion: "/finance/transaction/details/get",
          });
        } catch (capabilityError) {
          logger.error("[Lazada Finance Sync] Failed to record finance capability:", capabilityError);
        }
        throw error;
      }
    },
  );
}

/**
 * Sync logistics fee details from Lazada's SLB API. These provide the actual
 * shipping fee charged by the carrier per order line item, plus chargeable weight.
 * For orders with tracking numbers, also fetches estimated vs actual shipping via
 * GetShippingFee API to enable discrepancy detection.
 */
export async function syncLazadaLogisticsFees(
  sellerId: string,
  userId: string,
  createdAfter?: string,
  actorId = userId,
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  setActiveSeller(sellerId);

  const shop = await prisma.lazadaShop.findFirst({ where: { sellerId, userId } });
  if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId: actorId, channel: "lazada", syncType: "logistics_fees" },
    async () => {
      try {
        const tokenCheck = await validateLazadaToken();
        if (!tokenCheck.valid) {
          throw new Error(`Lazada token is invalid or expired: ${tokenCheck.error}. Please re-authorize the seller by connecting again.`);
        }

        const startDate = createdAfter || defaultFinanceStart();
        const startTime = new Date(startDate).getTime();
        const endTime = Date.now();

        const logisticsFees = await withLazadaRetry(() =>
          getAllLogisticsFeeDetailCustom({
            seller_id: sellerId,
            bill_start_time: startTime,
            bill_end_time: endTime,
          }),
        );

        let created = 0;
        let updated = 0;
        const errors: string[] = [];

        for (const fee of logisticsFees) {
          try {
            const orderId = fee.trade_order_id;
            const lineId = fee.trade_order_line_id;
            if (!orderId) continue;

            const externalId = `logistics:${orderId}:${lineId ?? "0"}:${fee.fee_code ?? "unknown"}`;
            const parsedAmount = typeof fee.amount === "number"
              ? { amountMinor: String(Math.round(fee.amount * 100)), amountScale: 2 }
              : fee.amount && typeof fee.amount === "object"
                ? parseLogisticsFeeAmount(fee.amount)
                : null;
            const currency = typeof fee.currency === "string" ? fee.currency : null;
            const trackingNumber = fee.package_info?.tracking_number ?? null;
            const sellerSku = fee.sku_info?.seller_sku ?? null;
            const chargeableWeight = fee.package_info?.package_chargeable_weight ?? null;

            const data = {
              statementExternalId: fee.statement_id ?? null,
              orderExternalId: orderId,
              itemExternalId: sellerSku ?? lineId ?? null,
              transactionType: "logistics_fee",
              feeType: typeof fee.fee_code === "string" ? fee.fee_code : null,
              feeName: typeof fee.fee_name === "string" ? fee.fee_name : null,
              amountMinor: parsedAmount?.amountMinor ?? null,
              amountScale: parsedAmount?.amountScale ?? 2,
              amount: null,
              financialQuality: parsedAmount ? "observed" : "unknown",
              unknownReason: parsedAmount ? null : "amount_not_parsed",
              currency,
              sourceObservedAt: new Date(),
              occurredAt: fee.fee_creation_date
                ? parseLazadaZoneDate(fee.fee_creation_date)
                : null,
              rawPayload: sanitizeMarketplaceRawPayload({
                ...fee,
                tracking_number: trackingNumber,
                seller_sku: sellerSku,
                package_chargeable_weight: chargeableWeight,
              }),
            };

            await prisma.marketplaceFinancialRecord.upsert({
              where: { platform_shopId_externalId: { platform: "lazada", shopId: shop.id, externalId } },
              create: { userId, platform: "lazada", shopId: shop.id, externalId, ...data },
              update: data,
            });

            if (await prisma.marketplaceFinancialRecord.findUnique({ where: { platform_shopId_externalId: { platform: "lazada", shopId: shop.id, externalId } }, select: { id: true } })) {
              updated++;
            } else {
              created++;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Logistics fee ${String(fee.trade_order_id ?? "unknown")}: ${message}`);
            logger.warn(`[Lazada Logistics Fee Sync] Failed to store record: ${message}`);
          }
        }

        await setMarketplaceCapability({
          userId,
          platform: "lazada",
          shopId: shop.id,
          capability: "finance",
          state: "available",
          endpointVersion: "/lbs/slb/queryLogisticsFeeDetail",
          observedFields: ["fee_code", "fee_name", "amount", "package_chargeable_weight"],
        });

        return { synced: logisticsFees.length, created, updated, errors };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await setMarketplaceCapability({
            userId,
            platform: "lazada",
            shopId: shop.id,
            capability: "finance",
            state: "failed",
            detail: message,
            endpointVersion: "/lbs/slb/queryLogisticsFeeDetail",
          });
        } catch (capabilityError) {
          logger.error("[Lazada Logistics Fee Sync] Failed to record capability:", capabilityError);
        }
        throw error;
      }
    },
  );
}

function parseLogisticsFeeAmount(amount: Record<string, unknown>): { amountMinor: string; amountScale: number } | null {
  // The amount field is documented as Object but structure varies.
  // Try common patterns: { value: "125000" }, { amount: "125000" }, or nested
  const value = amount.value ?? amount.amount ?? amount.total;
  if (typeof value === "string") return parseMoneyString(value);
  if (typeof value === "number") return { amountMinor: String(Math.round(value * 100)), amountScale: 2 };
  return null;
}

function parseMoneyString(value: string): { amountMinor: string; amountScale: number } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  const digits = `${whole.replace(/^0+(?=\d)/, "")}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return { amountMinor: `${sign === "-" && digits !== "0" ? "-" : ""}${digits}`, amountScale: fraction.length };
}

function parseLazadaZoneDate(zoneDate: Record<string, unknown>): Date | null {
  // Lazada zone date objects have year, month_value, day_of_month, hour, minute, second fields
  const year = Number(zoneDate.year);
  const month = Number(zoneDate.month_value);
  const day = Number(zoneDate.day_of_month);
  const hour = Number(zoneDate.hour ?? 0);
  const minute = Number(zoneDate.minute ?? 0);
  const second = Number(zoneDate.second ?? 0);
  if ([year, month, day].some((v) => Number.isNaN(v) || v === 0)) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Sync payout statements separately from transaction rows. Payouts are settlement
 * evidence, not order-level transactions, so they are never included in all-sync.
 */
export async function syncLazadaPayoutStatements(
  sellerId: string,
  userId: string,
  createdAfter?: string,
  actorId = userId,
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  setActiveSeller(sellerId);

  const shop = await prisma.lazadaShop.findFirst({ where: { sellerId, userId } });
  if (!shop) throw new Error(`Lazada seller ${sellerId} not found for user ${userId}`);

  return runWithSyncLog(
    { shopId: shop.id, userId: actorId, channel: "lazada", syncType: "payouts" },
    async () => {
      const tokenCheck = await validateLazadaToken();
      if (!tokenCheck.valid) {
        throw new Error(`Lazada token is invalid or expired: ${tokenCheck.error}. Please re-authorize the seller by connecting again.`);
      }

      const statements = await withLazadaRetry(() => getPayoutStatusCustom(createdAfter || defaultFinanceStart()));
      const errors: string[] = [];
      let created = 0;
      let updated = 0;
      let paidStatements = 0;

      for (const statement of statements) {
        try {
          const externalId = payoutExternalId(statement);
          const statementExternalId = documentedStatementReference(statement.statement_number);
          const payout = parsePayoutAmount(statement.payout);
          const paid = isPaidPayout(statement.paid);
          const data = {
            statementExternalId,
            orderExternalId: null,
            itemExternalId: null,
            transactionType: "payout_statement",
            // The endpoint only confirms whether this statement has been paid.
            feeType: paid ? "payout_paid" : "payout_unpaid",
            feeName: null,
            amountMinor: payout?.amountMinor ?? null,
            amountScale: payout?.amountScale ?? 2,
            amount: null,
            financialQuality: "unknown",
            unknownReason: payout ? "source_observed_unverified" : "source_value_malformed",
            currency: payout?.currency ?? null,
            sourceObservedAt: new Date(),
            occurredAt: validDate(statement.updated_at) ?? validDate(statement.created_at),
            rawPayload: sanitizeMarketplaceRawPayload(statement),
          };
          const where = {
            platform_shopId_externalId: { platform: "lazada", shopId: shop.id, externalId },
          };
          const existing = await prisma.marketplaceFinancialRecord.findUnique({
            where,
            select: { id: true, statementExternalId: true, orderExternalId: true, itemExternalId: true, transactionType: true, feeType: true, feeName: true, amountMinor: true, amountScale: true, financialQuality: true, unknownReason: true, currency: true, occurredAt: true, rawPayload: true },
          });
          await prisma.marketplaceFinancialRecord.upsert({
            where,
            create: { userId, platform: "lazada", shopId: shop.id, externalId, ...data },
            update: data,
          });
          if (existing) {
            updated++;
            if (financeSourceChanged(existing, data)) {
              await invalidateLazadaStatementReconciliations({ userId, shopId: shop.id, statementExternalIds: [existing.statementExternalId, statementExternalId] });
            }
          } else created++;
          if (paid) paidStatements++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Payout statement ${String(statement.statement_number ?? "unknown")}: ${message}`);
          logger.warn(`[Lazada Payout Sync] Failed to store payout statement: ${message}`);
        }
      }

      // A paid statement is the only direct evidence this endpoint provides for settlement availability.
      if (paidStatements > 0) {
        await setMarketplaceCapability({
          userId,
          platform: "lazada",
          shopId: shop.id,
          capability: "settlements",
          state: "available",
          endpointVersion: "/finance/payout/status/get",
          observedFields: ["statement_number", "payout", "paid", "updated_at"],
        });
      }
      return { synced: statements.length, created, updated, errors };
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
  actorId = userId,
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
      syncLazadaProducts(sellerId, userId, actorId),
      syncLazadaOrders(sellerId, userId, undefined, actorId),
    ]);

    return { products, orders };
  } finally {
    releaseSyncLock(sellerId);
  }
}
