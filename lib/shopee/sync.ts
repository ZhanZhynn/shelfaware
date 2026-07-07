/**
 * Shopee Sync Logic
 * Handles product and order synchronization from Shopee to local database.
 * Uses paginated API calls with upsert to handle repeated syncs.
 * Includes per-shop mutex to prevent concurrent syncs on the same shop.
 */

import { getShopeeSDK } from "./server";
import type { ItemStatus } from "@congminh1254/shopee-sdk/schemas";
import prisma from "@/prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

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

/** Cast value to Prisma InputJsonValue for JSON fields */
function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

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
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK();
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  // Find our ShopeeShop record
  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId },
  });

  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  // Create sync log
  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId,
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
            data: { ...productData, createdBy: userId },
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
                data: { ...variantData, createdBy: userId },
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
async function fetchEscrowDetails(
  sdk: ReturnType<typeof getShopeeSDK>,
  orderSns: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const details = new Map<string, Record<string, unknown>>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < orderSns.length; i += BATCH_SIZE) {
    const batch = orderSns.slice(i, i + BATCH_SIZE);
    try {
      const result = await sdk.payment.getEscrowDetailBatch({
        order_sn_list: batch,
      });
      // Response structure: { response: [{ escrow_detail: { order_sn, order_income, buyer_payment_info } }] }
      const resp = (result as unknown as { response?: Array<{ escrow_detail?: Record<string, unknown> }> }).response;
      const escrowList = Array.isArray(resp) ? resp : [];
      for (const wrapper of escrowList) {
        const detail = wrapper?.escrow_detail;
        if (detail) {
          const sn = String(detail.order_sn || "");
          if (sn) details.set(sn, detail);
        }
      }
    } catch (err) {
      logger.warn(`[Shopee Sync] Failed to fetch escrow details for batch starting ${batch[0]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return details;
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
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK();
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId },
  });

  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const fifteenDaysAgo = now - 15 * 24 * 60 * 60;
  const effectiveTimeFrom = timeFrom || fifteenDaysAgo;
  const effectiveTimeTo = timeTo || now;

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId,
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
    const escrowMap = await fetchEscrowDetails(sdk, orderSnStrings);

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
          where: { shopeeOrderId: sn },
        });

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
          // Fee fields from escrow API
          commissionFee: Number(orderIncome.commission_fee || 0),
          serviceFee: Number(orderIncome.service_fee || 0),
          sellerTxnFee: Number(orderIncome.seller_transaction_fee || 0),
          shippingFee: Number(orderIncome.actual_shipping_fee || orderIncome.final_shipping_fee || 0),
          estimatedShippingFee: Number(orderIncome.estimated_shipping_fee || 0),
          sellerIncome: Number(orderIncome.escrow_amount || 0),
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
            data: { ...orderData, createdBy: userId },
          });
          created++;
        }

        // Upsert order items from detail
        const orderItems = (detail?.item_list || []) as Array<Record<string, unknown>>;
        if (Array.isArray(orderItems) && orderItems.length > 0) {
          await prisma.shopeeOrderItem.deleteMany({
            where: { orderId: orderRecord.id },
          });

          const itemPromises = orderItems.map(
            (item: Record<string, unknown>) => {
              const shopeeItemId = Number(item.item_id || 0);
              const modelId = Number(item.model_id || 0);
              const variantId =
                shopeeItemId && modelId
                  ? variantLookup.get(`${shopeeItemId}:${modelId}`) ?? null
                  : null;
              return prisma.shopeeOrderItem.create({
                data: {
                  orderId: orderRecord.id,
                  variantId,
                  shopeeModelId: modelId,
                  productName: String(item.item_name || ""),
                  sku: String(item.model_sku || item.item_sku || ""),
                  quantity: Number(item.model_quantity_purchased || item.quantity || 0),
                  price: Number(item.model_original_price || item.model_discounted_price || 0),
                  subtotal:
                    Number(item.model_quantity_purchased || item.quantity || 0) *
                    Number(item.model_original_price || item.model_discounted_price || 0),
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
): Promise<{
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK();
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;

  const shop = await prisma.shopeeShop.findFirst({
    where: { shopId },
  });
  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId,
      syncType: "returns",
      status: "running",
      triggeredBy: "manual",
    },
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const WINDOW_DAYS = 15;
    const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60;
    const defaultTimeFrom = timeFrom || (now - 90 * 24 * 60 * 60); // 90 days back
    const effectiveTimeTo = timeTo || now;

    // Break into 15-day windows
    const windows: Array<{ from: number; to: number }> = [];
    let windowStart = defaultTimeFrom;
    while (windowStart < effectiveTimeTo) {
      const windowEnd = Math.min(windowStart + WINDOW_SECONDS, effectiveTimeTo);
      windows.push({ from: windowStart, to: windowEnd });
      windowStart = windowEnd;
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

        const returnData = {
          shopId: shop.id,
          userId,
          returnSn,
          orderSn: String(ret.order_sn || ""),
          status: String(ret.status || ""),
          refundAmount: Number(ret.refund_amount || 0),
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
          images: toInputJson(ret.image || []),
          items: toInputJson(ret.item || []),
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

// ─── Full Sync (with lock) ──────────────────────────────────────────────────

/**
 * Full sync — products + orders.
 * Acquires a per-shop lock to prevent concurrent syncs.
 */
export async function syncShopeeAll(
  shopId: number,
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
      syncShopeeProducts(shopId, userId),
      syncShopeeOrders(shopId, userId),
      syncShopeeAds(shopId, userId).catch((err) => {
        // Ads sync failure must not block products/orders sync
        logger.error(`[Shopee Sync] Ads sync failed for shop ${shopId}:`, err);
        return { synced: 0, campaigns: 0, errors: [String(err)] };
      }),
    ]);

    return { products, orders, ads };
  } finally {
    releaseSyncLock(shopId);
  }
}

// ─── Ads Sync Helpers ─────────────────────────────────────────────────────────

/** Format a Date to Shopee's DD-MM-YYYY format (for ads API request params). */
function toShopeeDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0"); // month is 0-indexed
  const yyyy = date.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Parse Shopee's DD-MM-YYYY date string into a UTC Date at midnight. */
function parseShopeeDate(s: string): Date {
  const parts = s.split("-").map(Number);
  const dd = parts[0] ?? 1;
  const mm = parts[1] ?? 1;
  const yyyy = parts[2] ?? 2000;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

/** Map a Shopee ads API snake_case row to our Prisma camelCase input shape. */
function mapAdsRow(row: Record<string, number | string>) {
  return {
    impressions: Number(row.impression ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    directOrder: Number(row.direct_order ?? 0),
    broadOrder: Number(row.broad_order ?? 0),
    directGmv: Number(row.direct_gmv ?? 0),
    broadGmv: Number(row.broad_gmv ?? 0),
    expense: Number(row.expense ?? 0),
    directRoas: Number(row.direct_roas ?? 0),
    broadRoas: Number(row.broad_roas ?? 0),
    directConversions: Number(row.direct_conversions ?? 0),
    broadConversions: Number(row.broad_conversions ?? 0),
    directItemSold: Number(row.direct_item_sold ?? 0),
    broadItemSold: Number(row.broad_item_sold ?? 0),
    costPerConversion: Number(row.cost_per_conversion ?? 0),
  };
}

import { withRetry } from "@/lib/api/retry";

/** Retry wrapper for Shopee ads API calls using generic withRetry. */
function withAdsRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  return withRetry(fn, {
    retries,
    match: /ads\.rate_limit|rate_limit|error_rate_limit/i,
    baseDelayMs: 1000,
    label: "Shopee Ads",
  });
}

/** Split a date range into chunks of at most `chunkDays` days (inclusive start, exclusive end). */
function chunkDateRange(start: Date, end: Date, chunkDays: number): { from: Date; to: Date }[] {
  const chunks: { from: Date; to: Date }[] = [];
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  let cursor = new Date(start);
  while (cursor < end) {
    const to = new Date(Math.min(cursor.getTime() + chunkMs, end.getTime()));
    // Shopee ads API requires start_date != end_date; if chunk collapses to a single day, skip
    if (to.getTime() - cursor.getTime() < 24 * 60 * 60 * 1000) {
      cursor = new Date(cursor.getTime() + chunkMs);
      continue;
    }
    chunks.push({ from: new Date(cursor), to: new Date(to) });
    cursor = new Date(to);
  }
  return chunks;
}

/**
 * Sync Shopee Ads performance data (shop-level + campaign-level daily).
 * @param shopId Shopee numeric shop ID
 * @param userId Owner user ID
 * @param daysBack How many days back to sync (default 30). Max 6 months per Shopee limits.
 */
export async function syncShopeeAds(
  shopId: number,
  userId: string,
  daysBack = 30,
): Promise<{
  synced: number;
  campaigns: number;
  errors: string[];
}> {
  const sdk = getShopeeSDK();
  const errors: string[] = [];
  let synced = 0;
  let campaigns = 0;

  const shop = await prisma.shopeeShop.findFirst({ where: { shopId } });
  if (!shop) {
    throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  }

  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId,
      syncType: "ads",
      status: "running",
      triggeredBy: "manual",
    },
  });

  try {
    // Date range: today minus daysBack → today (UTC midnight)
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);

    // Chunk into 28-day segments (Shopee max 1-month range, start != end)
    const chunks = chunkDateRange(start, end, 28);
    logger.info(`[Shopee Ads] Syncing ${daysBack} days in ${chunks.length} chunks for shop ${shopId}`);

    // ── Shop-level daily performance ──────────────────────────────────────────
    for (const chunk of chunks) {
      try {
        const result = await withAdsRetry(() =>
          sdk.ads.getAllCpcAdsDailyPerformance({
            start_date: toShopeeDate(chunk.from),
            end_date: toShopeeDate(chunk.to),
          }),
        );
        const resp = (
          result as unknown as {
            response?: Array<Record<string, number | string>>;
          }
        ).response;

        for (const row of resp ?? []) {
          const dateStr = String(row.date);
          const date = parseShopeeDate(dateStr);
          const mapped = mapAdsRow(row);
          await prisma.shopeeAdsDailyPerformance.upsert({
            where: { shopId_date: { shopId: shop.id, date } },
            update: { ...mapped, syncedAt: new Date() },
            create: { shopId: shop.id, userId, date, ...mapped },
          });
          synced++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`shop-level chunk ${toShopeeDate(chunk.from)}→${toShopeeDate(chunk.to)}: ${msg}`);
        logger.error(`[Shopee Ads] Shop-level chunk failed:`, error);
      }
    }

    // ── Snapshot total balance onto today's row ──────────────────────────────
    try {
      const balanceResult = await withAdsRetry(() => sdk.ads.getTotalBalance());
      const balanceResp = (
        balanceResult as unknown as {
          response?: { total_balance?: number; data_timestamp?: number };
        }
      ).response;
      const totalBalance = balanceResp?.total_balance;
      if (typeof totalBalance === "number") {
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        await prisma.shopeeAdsDailyPerformance.upsert({
          where: { shopId_date: { shopId: shop.id, date: today } },
          update: { totalBalance, syncedAt: new Date() },
          create: { shopId: shop.id, userId, date: today, totalBalance },
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`total_balance: ${msg}`);
      logger.error(`[Shopee Ads] Balance snapshot failed:`, error);
    }

    // ── Campaign-level daily performance ──────────────────────────────────────
    // 1. Paginate to collect all campaign IDs
    const allCampaignIds: number[] = [];
    let offset = 0;
    let hasNext = true;
    while (hasNext) {
      try {
        const result = await withAdsRetry(() =>
          sdk.ads.getProductLevelCampaignIdList({
            ad_type: "all",
            offset,
            limit: 100,
          }),
        );
        const resp = (
          result as unknown as {
            response?: {
              has_next_page?: boolean;
              campaign_list?: Array<{ campaign_id: number; ad_type?: string }>;
            };
          }
        ).response;
        const list = resp?.campaign_list ?? [];
        allCampaignIds.push(...list.map((c) => c.campaign_id));
        hasNext = resp?.has_next_page ?? false;
        offset += 100;
        if (list.length === 0) break; // safety: empty page
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`campaign list (offset ${offset}): ${msg}`);
        logger.error(`[Shopee Ads] Campaign ID pagination failed:`, error);
        break;
      }
    }

    logger.info(`[Shopee Ads] Found ${allCampaignIds.length} campaigns for shop ${shopId}`);

    // 2. For each batch of 100 campaigns × each date chunk, fetch performance
    for (let i = 0; i < allCampaignIds.length; i += 100) {
      const batch = allCampaignIds.slice(i, i + 100);
      const campaignIdList = batch.join(",");

      for (const chunk of chunks) {
        try {
          const result = await withAdsRetry(() =>
            sdk.ads.getProductCampaignDailyPerformance({
              start_date: toShopeeDate(chunk.from),
              end_date: toShopeeDate(chunk.to),
              campaign_id_list: campaignIdList,
            }),
          );
          const resp = (
            result as unknown as {
              response?: {
                campaign_list?: Array<{
                  campaign_id: number;
                  ad_type?: string;
                  campaign_placement?: string;
                  ad_name?: string;
                  daily_metrics?: Array<Record<string, number | string>>;
                }>;
              };
            }
          ).response;

          for (const campaign of resp?.campaign_list ?? []) {
            for (const row of campaign.daily_metrics ?? []) {
              const dateStr = String(row.date);
              const date = parseShopeeDate(dateStr);
              const mapped = mapAdsRow(row);
              await prisma.shopeeAdsCampaignDailyPerformance.upsert({
                where: {
                  shopId_campaignId_date: {
                    shopId: shop.id,
                    campaignId: String(campaign.campaign_id),
                    date,
                  },
                },
                update: {
                  ...mapped,
                  campaignName: campaign.ad_name,
                  adType: campaign.ad_type,
                  campaignPlacement: campaign.campaign_placement,
                  syncedAt: new Date(),
                },
                create: {
                  shopId: shop.id,
                  userId,
                  campaignId: String(campaign.campaign_id),
                  campaignName: campaign.ad_name,
                  adType: campaign.ad_type,
                  campaignPlacement: campaign.campaign_placement,
                  date,
                  ...mapped,
                },
              });
              campaigns++;
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`campaign batch ${i}-${i + batch.length} chunk ${toShopeeDate(chunk.from)}: ${msg}`);
          logger.error(`[Shopee Ads] Campaign batch chunk failed:`, error);
        }
      }
    }

    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: synced + campaigns,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });

    await prisma.shopeeShop.update({
      where: { id: shop.id },
      data: { lastSyncedAt: new Date() },
    });

    logger.info(
      `[Shopee Ads] Sync complete: ${synced} daily rows, ${campaigns} campaign rows, ${errors.length} errors`,
    );

    return { synced, campaigns, errors };
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
