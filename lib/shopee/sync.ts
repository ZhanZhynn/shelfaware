/**
 * Shopee Sync Logic
 * Handles product and order synchronization from Shopee to local database.
 * Uses paginated API calls with upsert to handle repeated syncs.
 * Includes per-shop mutex to prevent concurrent syncs on the same shop.
 */

import { getShopeeSDK } from "./server";
import { ingestShopeeAds as syncShopeeAds } from "./ads-sync";
import { safeAdsError } from "./ads-metrics";
export { syncShopeeAds };
import { shopeeOrderItemAmounts } from "./order-item";
import type { ItemStatus } from "@congminh1254/shopee-sdk/schemas";
import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { parseSourceNumber } from "@/lib/marketplace/analytics/provenance";
import { sanitizeMarketplaceRawPayload, toInputJson } from "@/lib/marketplace/json";
import { setMarketplaceCapability } from "@/lib/marketplace/analytics/capabilities";
import { projectShopeeAttributionForOrderIds } from "@/lib/marketplace-attribution/source-line-projector";
import { isSharedSkuMappingAnalyticsEnabled } from "@/lib/marketplace-attribution/feature-flags";

// Shopee order status mapping to our internal status
const ORDER_STATUS_MAP: Record<string, string> = {
  UNPAID: "pending",
  READY_TO_SHIP: "confirmed",
  PROCESSED: "processing",
  SHIPPED: "shipped",
  COMPLETED: "delivered",
  CANCELLED: "cancelled",
  INVOICE_PENDING: "confirmed",
};

const PAYMENT_STATUS_MAP: Record<string, string> = {
  UNPAID: "unpaid",
  READY_TO_SHIP: "paid",
  PROCESSED: "paid",
  SHIPPED: "paid",
  COMPLETED: "paid",
  CANCELLED: "refunded",
};

// ─── Sync Lock (per-shop mutex) ──────────────────────────────────────────────

const syncLocks = new Set<number>();

/**
 * Try to acquire the sync lock for a shop.
 * Returns true if lock acquired, false if already locked.
 */
function acquireSyncLock(shopId: number): boolean {
  if (syncLocks.has(shopId)) return false;
  syncLocks.add(shopId);
  return true;
}

/**
 * Release the sync lock for a shop.
 */
function releaseSyncLock(shopId: number): void {
  syncLocks.delete(shopId);
}

type SyncResult = {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
};

/**
 * Check if a shop is currently syncing.
 */
export function isShopSyncing(shopId: number): boolean {
  return syncLocks.has(shopId);
}

// ─── Product Sync ────────────────────────────────────────────────────────────

/**
 * Batch-fetch full product details for a list of item IDs.
 * Shopee getItemBaseInfo accepts max 50 IDs per call.
 */
async function fetchProductDetails(
  sdk: ReturnType<typeof getShopeeSDK>,
  itemIds: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const details = new Map<number, Record<string, unknown>>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    try {
      const result = await sdk.product.getItemBaseInfo({
        item_id_list: batch,
      });
      const resp = (result as unknown as { response?: { item_list?: Record<string, unknown>[] } }).response;
      const itemList = resp?.item_list || [];
      for (const item of itemList) {
        const id = Number((item as Record<string, unknown>).item_id);
        if (id) details.set(id, item);
      }
    } catch (err) {
      logger.warn(`[Shopee Sync] Failed to fetch product details for batch starting ${batch[0]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return details;
}

/**
 * Batch-fetch model list for products that have variants.
 * Needed because price_info is NOT returned for items with models.
 * getModelList accepts a single item_id per call.
 */
async function fetchModelList(
  sdk: ReturnType<typeof getShopeeSDK>,
  itemIds: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const modelMap = new Map<number, Record<string, unknown>>();

  for (const itemId of itemIds) {
    try {
      const result = await sdk.product.getModelList({ item_id: itemId });
      const resp = (result as unknown as { response?: Record<string, unknown> }).response;
      if (resp) {
        modelMap.set(itemId, resp);
      }
    } catch (err) {
      logger.warn(`[Shopee Sync] Failed to fetch model list for item ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return modelMap;
}

/**
 * Sync all products from a Shopee shop.
 * Step 1: getItemList → collect all item IDs
 * Step 2: getItemBaseInfo (batch 50) → get full details (name, images, stock, etc.)
 * Step 3: getModelList → get price for items with variants
 * Step 4: upsert into ShopeeProduct
 */
export async function syncShopeeProducts(
  shopId: number,
  userId: string,
  actorId = userId,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK(shopId);
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  // Find our ShopeeShop record
  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId, userId },
  });

  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  // Create sync log
  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId: actorId,
      syncType: "products",
      status: "running",
      triggeredBy: "manual",
    },
  });

  try {
    // Step 1: Collect all item IDs from getItemList (returns only id + status + update_time)
    const allItemIds: number[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await sdk.product.getItemList({
        offset,
        page_size: 100,
        item_status: ["NORMAL" as ItemStatus],
      });

      const response = (result as unknown as { response?: { item?: { item_id: number }[]; has_next_page?: boolean } }).response;
      const items = response?.item || [];

      for (const item of items) {
        allItemIds.push(Number(item.item_id));
      }

      offset += items.length;
      hasMore = response?.has_next_page === true;
      if (items.length === 0) hasMore = false;
    }

    logger.info(`[Shopee Sync] Found ${allItemIds.length} product IDs, fetching details...`);

    // Step 2: Fetch full product details in batches of 50
    const detailsMap = await fetchProductDetails(sdk, allItemIds);

    // Step 2.5: For items with models (variants), price_info is NOT returned.
    // Fetch model list to get price from models.
    const itemsWithModels = allItemIds.filter((id) => {
      const detail = detailsMap.get(id);
      return detail?.has_model === true;
    });
    const modelMap = itemsWithModels.length > 0
      ? await fetchModelList(sdk, itemsWithModels)
      : new Map<number, Record<string, unknown>>();

    // Step 3: Upsert each product with full details
    for (const itemId of allItemIds) {
      try {
        const detail = detailsMap.get(itemId);

        // Extract price from price_info array
        // If item has models, price_info is empty — get price from first model
        let price = 0;
        let originalPrice = 0;
        const priceInfo = detail?.price_info as Array<{ current_price?: number; original_price?: number }> | undefined;
        if (priceInfo && priceInfo.length > 0) {
          price = Number(priceInfo[0]?.current_price || priceInfo[0]?.original_price || 0);
          originalPrice = Number(priceInfo[0]?.original_price || priceInfo[0]?.current_price || 0);
        } else if (detail?.has_model) {
          // Get price from model list
          const modelResp = modelMap.get(itemId);
          const models = (modelResp?.model || []) as Array<{
            price_info?: Array<{ current_price?: number; original_price?: number }>;
            stock_info_v2?: { summary_info?: { total_available_stock?: number } };
          }>;
          if (models && models.length > 0) {
            // Use the first model's price as representative price
            const firstModel = models[0];
            const modelPriceInfo = firstModel?.price_info;
            if (modelPriceInfo && modelPriceInfo.length > 0) {
              price = Number(modelPriceInfo[0]?.current_price || modelPriceInfo[0]?.original_price || 0);
              originalPrice = Number(modelPriceInfo[0]?.original_price || modelPriceInfo[0]?.current_price || 0);
            }
          }
        }

        // Extract stock from stock_info_v2.summary_info.total_available_stock
        // Also aggregate stock from models if present
        let totalStock = 0;
        const stockInfoV2 = detail?.stock_info_v2 as { summary_info?: { total_available_stock?: number } } | undefined;
        if (stockInfoV2?.summary_info?.total_available_stock != null) {
          totalStock = Number(stockInfoV2.summary_info.total_available_stock);
        }

        // If item has models, also sum model stocks as fallback
        if (totalStock === 0 && detail?.has_model) {
          const modelResp = modelMap.get(itemId);
          const models = (modelResp?.model || []) as Array<{
            stock_info_v2?: { summary_info?: { total_available_stock?: number } };
          }>;
          if (models && models.length > 0) {
            totalStock = models.reduce((sum, m) => {
              const modelStock = m?.stock_info_v2?.summary_info?.total_available_stock;
              return sum + Number(modelStock || 0);
            }, 0);
          }
        }

        // Extract image URL
        const imageInfo = detail?.image as { image_url_list?: string[] } | undefined;
        const imageUrls = imageInfo?.image_url_list || [];
        const imageUrl = imageUrls[0] || "";

        // Extract tier_variation and models from modelMap for variant items
        const modelResp = detail?.has_model ? modelMap.get(itemId) ?? null : null;
        const tierVariation = modelResp?.tier_variation ?? null;
        const modelList = ((modelResp?.model || []) as Array<{
          model_id?: number;
          model_name?: string;
          model_sku?: string;
          model_status?: string;
          tier_index?: number[];
          price_info?: Array<{ current_price?: number; original_price?: number }>;
          stock_info_v2?: { summary_info?: { total_available_stock?: number } };
          weight?: string;
          dimension?: Record<string, unknown>;
        }>);

        const existing = await prisma.shopeeProduct.findFirst({
          where: { shopId: shop.id, shopeeItemId: itemId },
        });

        const productData = {
          shopId: shop.id,
          userId,
          shopeeItemId: itemId,
          itemName: String(detail?.item_name || ""),
          description: String(detail?.description || ""),
          itemSku: String(detail?.item_sku || "") || null,
          categoryId: Number(detail?.category_id || 0),
          price,
          originalPrice: originalPrice > 0 ? originalPrice : null,
          stock: totalStock,
          imageUrl,
          imageUrls: toInputJson(imageUrls),
          status: String(detail?.item_status || "NORMAL"),
          tierVariation: toInputJson(tierVariation),
          weight: Number(detail?.weight || 0),
          dimension: toInputJson(detail?.dimension ?? null),
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actorId,
        };

        let productRecord;
        if (existing) {
          productRecord = await prisma.shopeeProduct.update({
            where: { id: existing.id },
            data: productData,
          });
          updated++;
        } else {
          productRecord = await prisma.shopeeProduct.create({
            data: { ...productData, createdBy: actorId },
          });
          created++;
        }

        // Upsert variants if product has models
        if (modelList.length > 0) {
          const currentModelIds = new Set<number>();

          for (const m of modelList) {
            const modelId = Number(m.model_id || 0);
            if (!modelId) continue;
            currentModelIds.add(modelId);

            const variantPriceInfo = m.price_info?.[0];
            const variantPrice = Number(variantPriceInfo?.current_price || variantPriceInfo?.original_price || 0);
            const variantOriginalPrice = Number(variantPriceInfo?.original_price || variantPriceInfo?.current_price || 0);
            const variantStock = Number(m.stock_info_v2?.summary_info?.total_available_stock || 0);

            const parentItemSku = String(detail?.item_sku || "") || null;
            const variantData = {
              productId: productRecord.id,
              shopId: shop.id,
              userId,
              shopeeItemId: itemId,
              itemSku: parentItemSku,
              modelId,
              modelName: String(m.model_name || ""),
              modelSku: String(m.model_sku || "") || null,
              price: variantPrice,
              originalPrice: variantOriginalPrice > 0 ? variantOriginalPrice : null,
              stock: variantStock,
              status: String(m.model_status || "MODEL_NORMAL"),
              tierIndex: toInputJson(m.tier_index ?? null),
              weight: m.weight ? Number(m.weight) : null,
              dimension: toInputJson(m.dimension ?? null),
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
              updatedBy: actorId,
            };

            const existingVariant = await prisma.shopeeProductVariant.findFirst({
              where: { productId: productRecord.id, modelId },
            });

            if (existingVariant) {
              await prisma.shopeeProductVariant.update({
                where: { id: existingVariant.id },
                data: variantData,
              });
            } else {
              await prisma.shopeeProductVariant.create({
                data: { ...variantData, createdBy: actorId },
              });
            }
          }

          // Delete stale variants no longer in model list
          await prisma.shopeeProductVariant.deleteMany({
            where: {
              productId: productRecord.id,
              modelId: { notIn: Array.from(currentModelIds) },
            },
          });
        } else {
          // No models — remove any stale variants if product previously had them
          await prisma.shopeeProductVariant.deleteMany({
            where: { productId: productRecord.id },
          });
        }

        synced++;
      } catch (itemError) {
        const msg = `Failed to sync product ${itemId}: ${itemError instanceof Error ? itemError.message : String(itemError)}`;
        errors.push(msg);
        logger.warn(`[Shopee Sync] ${msg}`);
      }
    }

    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: synced,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });

    await prisma.shopeeShop.update({
      where: { id: shop.id },
      data: { lastSyncedAt: new Date(), updatedAt: new Date() },
    });

    logger.info(
      `[Shopee Sync] Products synced: ${synced} (created: ${created}, updated: ${updated}, errors: ${errors.length})`,
    );

    return { synced, created, updated, errors };
  } catch (error) {
    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

// ─── Order Sync ──────────────────────────────────────────────────────────────

/**
 * Batch-fetch full order details for a list of order_sn values.
 * Shopee getOrdersDetail accepts max 50 order_sn per call.
 */
async function fetchOrderDetails(
  sdk: ReturnType<typeof getShopeeSDK>,
  orderSns: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const details = new Map<string, Record<string, unknown>>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < orderSns.length; i += BATCH_SIZE) {
    const batch = orderSns.slice(i, i + BATCH_SIZE);
    try {
      const result = await sdk.order.getOrdersDetail({
        order_sn_list: batch,
        response_optional_fields: "item_list,buyer_username,buyer_user_id,recipient_address,total_amount,payment_method,shipping_carrier,package_list",
      });
      const resp = (result as unknown as { response?: { order_list?: Record<string, unknown>[] } }).response;
      const orderList = resp?.order_list || [];
      for (const order of orderList) {
        const sn = String((order as Record<string, unknown>).order_sn || "");
        if (sn) details.set(sn, order);
      }
    } catch (err) {
      logger.warn(`[Shopee Sync] Failed to fetch order details for batch starting ${batch[0]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return details;
}

/**
 * Batch-fetch escrow/income details for a list of order_sn values.
 * Fee breakdown (commission, service fee, seller income) comes from the
 * payment.getEscrowDetailBatch endpoint, NOT from getOrdersDetail.
 */
type EscrowFetchResult = {
  details: Map<string, Record<string, unknown>>;
  successfulRequests: number;
  errors: unknown[];
};

function escrowCapabilityFailure(error: unknown): {
  state: "failed" | "unauthorized";
  detail: string;
  errorCode?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const errorData = error && typeof error === "object" && "data" in error
    ? (error as { data?: unknown }).data
    : undefined;
  const data = errorData && typeof errorData === "object" ? errorData as Record<string, unknown> : {};
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  const errorCode = typeof data.error === "string"
    ? data.error
    : typeof data.error_code === "string"
      ? data.error_code
      : undefined;
  const unauthorized = status === 401 || status === 403 || /(?:error_auth|unauthori[sz]ed|forbidden|permission denied|access denied|invalid.*token|expired.*token)/i.test(`${errorCode ?? ""} ${message}`);

  return {
    state: unauthorized ? "unauthorized" : "failed",
    detail: message,
    errorCode,
  };
}

async function fetchEscrowDetails(
  sdk: ReturnType<typeof getShopeeSDK>,
  orderSns: string[],
): Promise<EscrowFetchResult> {
  const details = new Map<string, Record<string, unknown>>();
  const errors: unknown[] = [];
  let successfulRequests = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < orderSns.length; i += BATCH_SIZE) {
    const batch = orderSns.slice(i, i + BATCH_SIZE);
    try {
      const result = await sdk.payment.getEscrowDetailBatch({
        order_sn_list: batch,
      });
      successfulRequests++;
      // The current SDK returns response.order_income_list. Retain support for
      // the older wrapped form so already-observed escrow data is not discarded.
      const response = (result as unknown as {
        response?: { order_income_list?: Record<string, unknown>[] } | Array<{ escrow_detail?: Record<string, unknown> }>;
      }).response;
      const escrowList = Array.isArray(response)
        ? response.map((wrapper) => wrapper?.escrow_detail).filter((detail): detail is Record<string, unknown> => Boolean(detail))
        : Array.isArray(response?.order_income_list)
          ? response.order_income_list
          : [];
      for (const detail of escrowList) {
        const sn = String(detail.order_sn || "");
        if (sn) details.set(sn, detail);
      }
    } catch (err) {
      errors.push(err);
      logger.warn(`[Shopee Sync] Failed to fetch escrow details for batch starting ${batch[0]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { details, successfulRequests, errors };
}

async function storeEscrowFinancialRecords(input: {
  userId: string;
  shopId: string;
  escrowDetails: Map<string, Record<string, unknown>>;
  orderDetails: Map<string, Record<string, unknown>>;
}): Promise<{ written: number; errors: string[] }> {
  let written = 0;
  const errors: string[] = [];

  for (const [orderSn, escrowDetail] of input.escrowDetails) {
    try {
      const orderDetail = input.orderDetails.get(orderSn);
      const orderIncome = (escrowDetail.order_income ?? {}) as Record<string, unknown>;
      const escrowAmount = parseSourceNumber(orderIncome.escrow_amount, "shopee.escrow.order_income.escrow_amount");
      const amountMinor = escrowAmount.value == null ? null : String(Math.round(escrowAmount.value * 100));
      const createdAt = orderDetail?.create_time;
      const occurredAt = typeof createdAt === "number" || typeof createdAt === "string"
        ? new Date(Number(createdAt) * 1000)
        : null;
      await prisma.marketplaceFinancialRecord.upsert({
        where: {
          platform_shopId_externalId: {
            platform: "shopee",
            shopId: input.shopId,
            externalId: `escrow:${orderSn}`,
          },
        },
        create: {
          userId: input.userId,
          platform: "shopee",
          shopId: input.shopId,
          externalId: `escrow:${orderSn}`,
          orderExternalId: orderSn,
          transactionType: "order_escrow",
          feeType: "escrow_detail",
          feeName: "Shopee order escrow detail",
          amount: escrowAmount.value,
          amountMinor,
          amountScale: 2,
          financialQuality: escrowAmount.quality,
          unknownReason: escrowAmount.unknownReason ?? null,
          currency: typeof orderDetail?.currency === "string" ? orderDetail.currency : null,
          occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
          sourceObservedAt: new Date(),
          rawPayload: sanitizeMarketplaceRawPayload(escrowDetail),
        },
        update: {
          amount: escrowAmount.value,
          amountMinor,
          amountScale: 2,
          financialQuality: escrowAmount.quality,
          unknownReason: escrowAmount.unknownReason ?? null,
          currency: typeof orderDetail?.currency === "string" ? orderDetail.currency : null,
          occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
          sourceObservedAt: new Date(),
          rawPayload: sanitizeMarketplaceRawPayload(escrowDetail),
        },
      });
      written++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to store escrow observation for order ${orderSn}: ${message}`);
      logger.warn(`[Shopee Sync] Failed to store escrow observation for order ${orderSn}: ${message}`);
    }
  }

  return { written, errors };
}

/**
 * Fetch package details for SLA tracking.
 * Uses searchPackageList (status=2 = ToProcess/unshipped) to get packages with ship_by_date.
 * SearchPackageListPackage already includes ship_by_date, days_to_ship, fulfillment_status.
 * Returns a Map of order_sn → { shipByDate, packageNumber, fulfillmentStatus, daysToShip }.
 */
async function fetchPackageDetails(
  sdk: ReturnType<typeof getShopeeSDK>,
): Promise<Map<string, { shipByDate: Date | null; packageNumber: string; fulfillmentStatus: string; daysToShip: number | null }>> {
  const result = new Map<string, { shipByDate: Date | null; packageNumber: string; fulfillmentStatus: string; daysToShip: number | null }>();

  try {
    let cursor = "";
    let hasMore = true;

    while (hasMore) {
      const searchResult = await sdk.order.searchPackageList({
        filter: { package_status: 2 }, // 2 = ToProcess (unshipped)
        pagination: { page_size: 100, cursor },
        sort: { sort_field: "ship_by_date", sort_direction: "ASC" },
      });

      const resp = (searchResult as unknown as { response?: { more?: boolean; next_cursor?: string; package_list?: Array<Record<string, unknown>> } }).response;
      const packages = resp?.package_list || [];
      hasMore = resp?.more === true;
      cursor = resp?.next_cursor || "";

      for (const pkg of packages) {
        const orderSn = String(pkg.order_sn || "");
        if (!orderSn) continue;

        const shipByDateUnix = Number(pkg.ship_by_date || 0);
        const shipByDate = shipByDateUnix > 0 ? new Date(shipByDateUnix * 1000) : null;

        result.set(orderSn, {
          shipByDate,
          packageNumber: String(pkg.package_number || ""),
          fulfillmentStatus: String(pkg.fulfillment_status || ""),
          daysToShip: pkg.days_to_ship != null ? Number(pkg.days_to_ship) : null,
        });
      }
    }
  } catch (err) {
    logger.warn(`[Shopee Sync] Failed to fetch package details: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sync orders from a Shopee shop.
 * Step 1: getOrderList → collect order_sn + status
 * Step 2: getOrdersDetail (batch 50) → get full details (items, buyer, address, etc.)
 * Step 2.5: getEscrowDetailBatch → fee breakdown
 * Step 2.6: searchPackageList + getPackageDetail → SLA ship_by_date
 * Step 3: upsert into ShopeeOrder + ShopeeOrderItem
 */
export async function syncShopeeOrders(
  shopId: number,
  userId: string,
  timeFrom?: number,
  timeTo?: number,
  actorId = userId,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK(shopId);
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId, userId },
  });

  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const fifteenDaysAgo = now - 15 * 24 * 60 * 60;
  const effectiveTimeFrom = timeFrom ?? fifteenDaysAgo;
  const effectiveTimeTo = timeTo ?? now;

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId: actorId,
      syncType: "orders",
      status: "running",
      triggeredBy: "manual",
    },
  });

  try {
    // Step 1: Collect all order_sn from getOrderList (returns only order_sn + status)
    const allOrderSns: { sn: string; status?: string }[] = [];
    let cursor = "";
    let hasMore = true;

    while (hasMore) {
      const result = await sdk.order.getOrderList({
        time_range_field: "create_time",
        time_from: effectiveTimeFrom,
        time_to: effectiveTimeTo,
        page_size: 100,
        cursor,
      });

      const response = (result as unknown as { response?: { order_list?: { order_sn: string; order_status?: string }[]; more?: boolean; next_cursor?: string } }).response;
      const orders = response?.order_list || [];

      for (const order of orders) {
        allOrderSns.push({
          sn: String(order.order_sn || ""),
          status: order.order_status,
        });
      }

      cursor = response?.next_cursor || "";
      hasMore = response?.more === true;
      if (orders.length === 0) hasMore = false;
    }

    logger.info(`[Shopee Sync] Found ${allOrderSns.length} order IDs, fetching details...`);

    // Step 2: Fetch full order details in batches of 50
    const orderSnStrings = allOrderSns.map((o) => o.sn);
    const detailsMap = await fetchOrderDetails(sdk, orderSnStrings);

    // Step 2.5: Fetch escrow/income details for fee breakdown
    const escrowResult = await fetchEscrowDetails(sdk, orderSnStrings);
    const escrowMap = escrowResult.details;
    const escrowRecords = await storeEscrowFinancialRecords({
      userId,
      shopId: shop.id,
      escrowDetails: escrowMap,
      orderDetails: detailsMap,
    });

    // Capability availability requires both an observed escrow endpoint and
    // durable raw ledger observations. Escrow failures do not block order sync.
    try {
      if (escrowResult.errors.length > 0) {
        const failures = escrowResult.errors.map(escrowCapabilityFailure);
        const failure = failures.find((candidate) => candidate.state === "unauthorized")
          ?? escrowCapabilityFailure(escrowResult.errors[0]);
        await setMarketplaceCapability({
          userId,
          platform: "shopee",
          shopId: shop.id,
          capability: "finance",
          state: failure.state,
          detail: failure.detail,
          errorCode: failure.errorCode,
          endpointVersion: "/payment/get_escrow_detail_batch",
        });
      } else if (escrowRecords.errors.length > 0) {
        await setMarketplaceCapability({
          userId,
          platform: "shopee",
          shopId: shop.id,
          capability: "finance",
          state: "failed",
          detail: escrowRecords.errors[0],
          endpointVersion: "/payment/get_escrow_detail_batch",
        });
      } else if (escrowResult.successfulRequests > 0 && escrowRecords.written > 0) {
        await setMarketplaceCapability({
          userId,
          platform: "shopee",
          shopId: shop.id,
          capability: "finance",
          state: "available",
          endpointVersion: "/payment/get_escrow_detail_batch",
          observedFields: ["order_income_list.order_sn", "order_income_list.order_income", "order_income_list.buyer_payment_info"],
        });
      }
    } catch (capabilityError) {
      logger.error("[Shopee Sync] Failed to record escrow finance capability:", capabilityError);
    }

    // Step 2.6: Fetch package details for SLA ship_by_date tracking
    const packageMap = await fetchPackageDetails(sdk);

    // Step 2.7: Build variant lookup map for O(1) order item → variant linkage
    // Key: `${shopeeItemId}:${modelId}` → ShopeeProductVariant.id
    const variantLookup = new Map<string, string>();
    {
      const allVariants = await prisma.shopeeProductVariant.findMany({
        where: { shopId: shop.id },
        select: { id: true, shopeeItemId: true, modelId: true },
      });
      for (const v of allVariants) {
        variantLookup.set(`${v.shopeeItemId}:${v.modelId}`, v.id);
      }
      logger.info(`[Shopee Sync] Built variant lookup map with ${variantLookup.size} entries`);
    }

    // Step 3: Upsert each order with full details
    for (const { sn, status: listStatus } of allOrderSns) {
      try {
        const detail = detailsMap.get(sn);
        const escrow = escrowMap.get(sn);
        const pkgInfo = packageMap.get(sn);
        const orderIncome = (escrow?.order_income || {}) as Record<string, unknown>;
        const buyerPaymentInfo = (escrow?.buyer_payment_info || {}) as Record<string, unknown>;

        // Use detailed status if available, fallback to list status
        const orderStatus = String(
          (detail?.order_status as string) || listStatus || "UNPAID"
        );

        const recipientAddress = detail?.recipient_address || null;
        const logistics = (Array.isArray(detail?.package_list) ? detail?.package_list?.[0] : null) as Record<string, unknown> || {};

        const shopeeCreatedAt = detail?.create_time
          ? new Date(Number(detail.create_time) * 1000)
          : null;
        const shopeeUpdatedAt = detail?.update_time
          ? new Date(Number(detail.update_time) * 1000)
          : null;

        const existing = await prisma.shopeeOrder.findFirst({
          where: { shopId: shop.id, shopeeOrderId: sn },
        });

        const commissionFee = parseSourceNumber(orderIncome.commission_fee, "shopee.escrow.order_income.commission_fee");
        const serviceFee = parseSourceNumber(orderIncome.service_fee, "shopee.escrow.order_income.service_fee");
        const sellerTxnFee = parseSourceNumber(orderIncome.seller_transaction_fee, "shopee.escrow.order_income.seller_transaction_fee");
        const shippingFee = parseSourceNumber(orderIncome.actual_shipping_fee, "shopee.escrow.order_income.actual_shipping_fee");
        const estimatedShippingFee = parseSourceNumber(orderIncome.estimated_shipping_fee, "shopee.escrow.order_income.estimated_shipping_fee");
        const sellerIncome = parseSourceNumber(orderIncome.escrow_amount, "shopee.escrow.order_income.escrow_amount");
        const orderData = {
          shopId: shop.id,
          userId,
          shopeeOrderId: sn,
          orderStatus,
          paymentStatus: PAYMENT_STATUS_MAP[orderStatus] || "unpaid",
          totalAmount: Number(detail?.total_amount || 0),
          currency: String(detail?.currency || "SGD"),
          region: String(detail?.region || ""),
          buyerUsername: String(detail?.buyer_username || ""),
          buyerEmail: "", // Shopee doesn't expose buyer email in order detail
          shippingAddress: toInputJson(recipientAddress),
          trackingNumber: String((logistics as Record<string, unknown>).tracking_number || ""),
          trackingCarrier: String(detail?.shipping_carrier || ""),
          logisticsStatus: String((logistics as Record<string, unknown>).status || ""),
          shopeeCreatedAt,
          shopeeUpdatedAt,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actorId,
          // Fee fields from escrow API
          commissionFee: commissionFee.value,
          serviceFee: serviceFee.value,
          sellerTxnFee: sellerTxnFee.value,
          shippingFee: shippingFee.value,
          estimatedShippingFee: estimatedShippingFee.value,
          sellerIncome: sellerIncome.value,
          financialQuality: "unknown",
          financialRevision: "source-v1",
          qualityMarkedAt: new Date(),
          sourceObservedAt: new Date(),
          rawFinancialPayload: sanitizeMarketplaceRawPayload({ order_income: orderIncome, buyer_payment_info: buyerPaymentInfo }),
          buyerPaymentMethod: String(buyerPaymentInfo.buyer_payment_method || detail?.payment_method || ""),
          // SLA fields from package detail
          shipByDate: pkgInfo?.shipByDate || null,
          packageNumber: pkgInfo?.packageNumber || null,
          fulfillmentStatus: pkgInfo?.fulfillmentStatus || null,
          daysToShip: pkgInfo?.daysToShip || null,
        };

        let orderRecord;

        if (existing) {
          orderRecord = await prisma.shopeeOrder.update({
            where: { id: existing.id },
            data: orderData,
          });
          updated++;
        } else {
          orderRecord = await prisma.shopeeOrder.create({
            data: { ...orderData, createdBy: actorId },
          });
          created++;
        }

        // Upsert order items from detail
        const orderItems = (detail?.item_list || []) as Array<Record<string, unknown>>;
        if (Array.isArray(orderItems) && orderItems.length > 0) {
          const pricedItems = orderItems.map((item) => {
            const amounts = shopeeOrderItemAmounts(item);
            if (amounts.quantity === null || amounts.unitPrice === null || amounts.subtotal === null) {
              throw new Error("Shopee order item has no usable quantity or sales price");
            }
            return { item, quantity: amounts.quantity, price: amounts.unitPrice, subtotal: amounts.subtotal };
          });
          await prisma.shopeeOrderItem.deleteMany({
            where: { orderId: orderRecord.id },
          });

          const itemPromises = pricedItems.map(
            ({ item, quantity, price, subtotal }) => {
              const shopeeItemId = Number(item.item_id || 0);
              // Shopee documents model_id 0 as the sentinel for an item with
              // no models. Store absence as null rather than a fake variant.
              const sourceModelId = Number(item.model_id);
              const modelId = Number.isFinite(sourceModelId) && sourceModelId > 0
                ? sourceModelId
                : null;
              const variantId =
                shopeeItemId && modelId != null
                  ? variantLookup.get(`${shopeeItemId}:${modelId}`) ?? null
                  : null;
              return prisma.shopeeOrderItem.create({
                data: {
                  orderId: orderRecord.id,
                  variantId,
                  shopeeItemId: shopeeItemId || null,
                  shopeeModelId: modelId,
                  productName: String(item.item_name || ""),
                  sku: String(item.model_sku || item.item_sku || ""),
                  quantity,
                  price,
                  subtotal,
                },
              });
            },
          );

          await Promise.all(itemPromises);
        }

        synced++;
      } catch (itemError) {
        const msg = `Failed to sync order ${sn}: ${itemError instanceof Error ? itemError.message : String(itemError)}`;
        errors.push(msg);
        logger.warn(`[Shopee Sync] ${msg}`);
      }
    }

    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: synced,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });

    await prisma.shopeeShop.update({
      where: { id: shop.id },
      data: { lastSyncedAt: new Date(), updatedAt: new Date() },
    });

    if (isSharedSkuMappingAnalyticsEnabled()) {
      try {
        const attribution = await projectShopeeAttributionForOrderIds(shop.id, allOrderSns.map((order) => order.sn));
        logger.info(`[Shopee Sync] Attribution projected: ${attribution.sourceLines.total} source lines, ${attribution.wmsFacts} component facts`);
      } catch (attributionError) {
        // Order sync must not be rolled back because analytics projection can be
        // retried idempotently after mapping or recipe corrections.
        logger.error("[Shopee Sync] Attribution projection failed:", attributionError);
      }
    }

    logger.info(
      `[Shopee Sync] Orders synced: ${synced} (created: ${created}, updated: ${updated}, errors: ${errors.length})`,
    );

    return { synced, created, updated, errors };
  } catch (error) {
    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

// ─── Return Sync ─────────────────────────────────────────────────────────────

/**
 * Sync returns from a Shopee shop.
 * Uses getReturnList with cursor pagination.
 * Shopee limits create_time window to 15 days per call,
 * so for 90 days of history we make 6 calls.
 */
export async function syncShopeeReturns(
  shopId: number,
  userId: string,
  timeFrom?: number,
  timeTo?: number,
  actorId = userId,
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK(shopId);
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId, userId },
  });
  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId: actorId,
      syncType: "returns",
      status: "running",
      triggeredBy: "manual",
    },
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const WINDOW_DAYS = 15;
    const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60;
    const hasExplicitWindow = timeFrom !== undefined || timeTo !== undefined;
    const defaultTimeFrom = timeFrom ?? (now - 90 * 24 * 60 * 60); // 90 days back
    const effectiveTimeTo = timeTo ?? now;

    // Break into 15-day windows
    const windows: Array<{ from: number; to: number }> = [];
    let windowStart = defaultTimeFrom;
    while (hasExplicitWindow ? windowStart <= effectiveTimeTo : windowStart < effectiveTimeTo) {
      const windowEnd = Math.min(windowStart + WINDOW_SECONDS - (hasExplicitWindow ? 1 : 0), effectiveTimeTo);
      windows.push({ from: windowStart, to: windowEnd });
      windowStart = windowEnd + (hasExplicitWindow ? 1 : 0);
    }

    const allReturns: Record<string, unknown>[] = [];

    for (const win of windows) {
      let pageNo = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const result = await sdk.returns.getReturnList({
            page_no: pageNo,
            page_size: 100,
            create_time_from: win.from,
            create_time_to: win.to,
          });

          const resp = (result as unknown as { response?: { more?: boolean; return?: Record<string, unknown>[] } }).response;
          const returns = resp?.return || [];
          hasMore = resp?.more === true;

          for (const ret of returns) {
            allReturns.push(ret);
          }

          pageNo++;
          if (returns.length === 0) hasMore = false;
        } catch (err) {
          logger.warn(`[Shopee Sync] Failed to fetch returns for window ${win.from}-${win.to}, page ${pageNo}: ${err instanceof Error ? err.message : String(err)}`);
          hasMore = false;
        }
      }
    }

    logger.info(`[Shopee Sync] Found ${allReturns.length} returns`);

    for (const ret of allReturns) {
      try {
        const returnSn = String(ret.return_sn || "");
        if (!returnSn) continue;

        const existing = await prisma.shopeeReturn.findFirst({
          where: { returnSn },
        });

        const refund = parseSourceNumber(ret.refund_amount, "shopee.return.refund_amount");
        const returnData = {
          shopId: shop.id,
          userId,
          returnSn,
          orderSn: String(ret.order_sn || ""),
          status: String(ret.status || ""),
          refundAmount: refund.value,
          financialQuality: refund.quality,
          sourceObservedAt: refund.value === null ? null : new Date(),
          currency: String(ret.currency || ""),
          reason: String(ret.reason || ""),
          textReason: String(ret.text_reason || ""),
          trackingNumber: String(ret.tracking_number || ""),
          needsLogistics: Boolean(ret.needs_logistics),
          amountBeforeDiscount: Number(ret.amount_before_discount || 0),
          negotiationStatus: String(ret.negotiation_status || ""),
          sellerProofStatus: String(ret.seller_proof_status || ""),
          sellerCompensationStatus: String(ret.seller_compensation_status || ""),
          returnRefundType: String(ret.return_refund_type || ""),
          returnSolution: ret.return_solution != null ? Number(ret.return_solution) : null,
          returnRefundRequestType: ret.return_refund_request_type != null ? Number(ret.return_refund_request_type) : null,
          validationType: String(ret.validation_type || ""),
          returnShipDueDate: ret.return_ship_due_date ? new Date(Number(ret.return_ship_due_date) * 1000) : null,
          returnSellerDueDate: ret.return_seller_due_date ? new Date(Number(ret.return_seller_due_date) * 1000) : null,
          images: sanitizeMarketplaceRawPayload(ret.image || []),
          items: sanitizeMarketplaceRawPayload(ret.item || []),
          buyerUsername: String((ret.user as Record<string, unknown>)?.username || ""),
          buyerEmail: String((ret.user as Record<string, unknown>)?.email || ""),
          shopeeCreatedAt: ret.create_time ? new Date(Number(ret.create_time) * 1000) : null,
          shopeeUpdatedAt: ret.update_time ? new Date(Number(ret.update_time) * 1000) : null,
          updatedAt: new Date(),
        };

        if (existing) {
          await prisma.shopeeReturn.update({
            where: { id: existing.id },
            data: returnData,
          });
          updated++;
        } else {
          await prisma.shopeeReturn.create({
            data: returnData,
          });
          created++;
        }

        synced++;
      } catch (itemError) {
        const msg = `Failed to sync return ${ret.return_sn}: ${itemError instanceof Error ? itemError.message : String(itemError)}`;
        errors.push(msg);
        logger.warn(`[Shopee Sync] ${msg}`);
      }
    }

    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: synced,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });

    logger.info(
      `[Shopee Sync] Returns synced: ${synced} (created: ${created}, updated: ${updated}, errors: ${errors.length})`,
    );

    return { synced, created, updated, errors };
  } catch (error) {
    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

function payoutExternalId(encryptedPayoutId: string): string {
  // Keep payout statements distinct from order-level escrow observations.
  return `payout:${encodeURIComponent(encryptedPayoutId)}`;
}

function payoutOccurredAt(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function payoutEvidencePayload(payout: Record<string, unknown>) {
  // get_payout_info includes a payee account identifier; retain only statement evidence.
  return sanitizeMarketplaceRawPayload({
    encrypted_payout_id: payout.encrypted_payout_id,
    from_currency: payout.from_currency,
    payout_currency: payout.payout_currency,
    from_amount: payout.from_amount,
    payout_amount: payout.payout_amount,
    exchange_rate: payout.exchange_rate,
    payout_time: payout.payout_time,
    pay_service: payout.pay_service,
  });
}

/**
 * Manually ingest actual Shopee CB payouts. The documented get_payout_info
 * endpoint returns actual payout amounts and payout times, rather than pending
 * estimates, so each durable row is final payout evidence.
 */
export async function syncShopeePayoutStatements(
  shopId: number,
  userId: string,
  daysBackOrWindow: number | { timeFrom: number; timeTo: number } = 15,
  actorId = userId,
): Promise<SyncResult> {
  const sdk = getShopeeSDK(shopId);
  const shop = await prisma.shopeeShop.findFirst({ where: { shopId, userId } });
  if (!shop) throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId: actorId,
      syncType: "payouts",
      status: "running",
      triggeredBy: "manual",
    },
  });

  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;
  let finalPayouts = 0;

  try {
    const now = Math.floor(Date.now() / 1000);
    const requestedWindow = typeof daysBackOrWindow === "object" ? daysBackOrWindow : null;
    const requestedDaysBack = typeof daysBackOrWindow === "number" ? daysBackOrWindow : undefined;
    const safeDaysBack = requestedDaysBack !== undefined && Number.isInteger(requestedDaysBack) && requestedDaysBack > 0
      ? Math.min(requestedDaysBack, 180)
      : 15;
    const effectiveTimeFrom = requestedWindow?.timeFrom ?? now - safeDaysBack * 24 * 60 * 60;
    const effectiveTimeTo = requestedWindow?.timeTo ?? now;
    const windowSeconds = 15 * 24 * 60 * 60;
    const seenPayoutIds = new Set<string>();

    // The endpoint permits at most fifteen days per request.
    for (let from = effectiveTimeFrom; requestedWindow ? from <= effectiveTimeTo : from < effectiveTimeTo; from += windowSeconds) {
      const to = Math.min(from + windowSeconds - (requestedWindow ? 1 : 0), effectiveTimeTo);
      let cursor = "";
      let more = true;

      while (more) {
        try {
          const result = await sdk.payment.getPayoutInfo({
            payout_time_from: from,
            payout_time_to: to,
            page_size: 100,
            cursor,
          });
          const response = (result as unknown as {
            response?: { payout_list?: Record<string, unknown>[]; more?: boolean; next_cursor?: string };
          }).response;
          const payouts = response?.payout_list ?? [];

          for (const payout of payouts) {
            const encryptedPayoutId = typeof payout.encrypted_payout_id === "string"
              ? payout.encrypted_payout_id.trim()
              : "";
            const occurredAt = payoutOccurredAt(payout.payout_time);
            const payoutCurrency = typeof payout.payout_currency === "string"
              ? payout.payout_currency.trim().toUpperCase()
              : "";
            const payoutAmount = parseSourceNumber(payout.payout_amount, "shopee.payout.payout_amount");

            if (!encryptedPayoutId || !occurredAt || !payoutCurrency || payoutAmount.value === null) {
              errors.push("Payout record omitted documented final payout evidence (encrypted_payout_id, payout_amount, payout_currency, or payout_time).");
              continue;
            }
            if (seenPayoutIds.has(encryptedPayoutId)) continue;
            seenPayoutIds.add(encryptedPayoutId);

            const externalId = payoutExternalId(encryptedPayoutId);
            const data = {
              statementExternalId: encryptedPayoutId,
              orderExternalId: null,
              itemExternalId: null,
              transactionType: "payout_statement",
              feeType: "payout_paid",
              feeName: "Shopee final payout",
              // The API documents a float without a minor-unit scale, so retain the
              // source value in evidence rather than inventing an exact amount.
              amountMinor: null,
              amountScale: 2,
              amount: null,
              financialQuality: "unknown",
              unknownReason: payoutAmount.unknownReason,
              currency: payoutCurrency,
              sourceObservedAt: new Date(),
              occurredAt,
              rawPayload: payoutEvidencePayload(payout),
            };
            const where = {
              platform_shopId_externalId: { platform: "shopee", shopId: shop.id, externalId },
            };
            const existing = await prisma.marketplaceFinancialRecord.findUnique({ where, select: { id: true } });
            await prisma.marketplaceFinancialRecord.upsert({
              where,
              create: { userId, platform: "shopee", shopId: shop.id, externalId, ...data },
              update: data,
            });
            if (existing) updated++; else created++;
            synced++;
            finalPayouts++;
          }

          more = response?.more === true;
          cursor = response?.next_cursor ?? "";
          if (more && !cursor) {
            errors.push(`Payout response for ${from}-${to} indicated another page without next_cursor.`);
            break;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Payout request ${from}-${to}: ${message}`);
          logger.warn(`[Shopee Payout Sync] Failed to fetch payouts for ${from}-${to}: ${message}`);
          break;
        }
      }
    }

    // Settlement availability is observed only after a final payout statement is stored.
    if (finalPayouts > 0) {
      await setMarketplaceCapability({
        userId,
        platform: "shopee",
        shopId: shop.id,
        capability: "settlements",
        state: "available",
        endpointVersion: "/payment/get_payout_info",
        observedFields: ["encrypted_payout_id", "payout_amount", "payout_currency", "payout_time"],
      });
    }

    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: synced,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });
    return { synced, created, updated, errors };
  } catch (error) {
    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

// ─── Full Sync (with lock) ──────────────────────────────────────────────────

/**
 * Full sync — products + orders.
 * Acquires a per-shop lock to prevent concurrent syncs.
 */
export async function syncShopeeAll(
  shopId: number,
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
  ads: {
    synced: number;
    campaigns: number;
    errors: string[];
  };
}> {
  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for shop ${shopId}`);
  }

  try {
    const [products, orders, ads] = await Promise.all([
      syncShopeeProducts(shopId, userId, actorId),
      syncShopeeOrders(shopId, userId, undefined, undefined, actorId),
      syncShopeeAds(shopId, userId, 30, actorId).catch((err) => {
        // Ads sync failure must not block products/orders sync
        const code = safeAdsError(err);
        logger.error(`[Shopee Sync] Ads sync failed for shop ${shopId}:`, { code });
        return { synced: 0, campaigns: 0, errors: [code] };
      }),
    ]);

    return { products, orders, ads };
  } finally {
    releaseSyncLock(shopId);
  }
}
