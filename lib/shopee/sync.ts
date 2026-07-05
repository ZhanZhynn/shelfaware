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

        // Extract models
        const models = detail?.has_model ? detail : null;

        const existing = await prisma.shopeeProduct.findFirst({
          where: { shopId: shop.id, shopeeItemId: itemId },
        });

        const productData = {
          shopId: shop.id,
          userId,
          shopeeItemId: itemId,
          itemName: String(detail?.item_name || ""),
          description: String(detail?.description || ""),
          categoryId: Number(detail?.category_id || 0),
          price,
          originalPrice: originalPrice > 0 ? originalPrice : null,
          stock: totalStock,
          imageUrl,
          imageUrls: toInputJson(imageUrls),
          status: String(detail?.item_status || "NORMAL"),
          models: toInputJson(models),
          weight: Number(detail?.weight || 0),
          dimension: toInputJson(detail?.dimension ?? null),
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        };

        if (existing) {
          await prisma.shopeeProduct.update({
            where: { id: existing.id },
            data: productData,
          });
          updated++;
        } else {
          await prisma.shopeeProduct.create({
            data: { ...productData, createdBy: userId },
          });
          created++;
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
            (item: Record<string, unknown>) =>
              prisma.shopeeOrderItem.create({
                data: {
                  orderId: orderRecord.id,
                  shopeeModelId: Number(item.model_id || 0),
                  productName: String(item.item_name || ""),
                  sku: String(item.model_sku || item.item_sku || ""),
                  quantity: Number(item.model_quantity_purchased || item.quantity || 0),
                  price: Number(item.model_original_price || item.model_discounted_price || 0),
                  subtotal:
                    Number(item.model_quantity_purchased || item.quantity || 0) *
                    Number(item.model_original_price || item.model_discounted_price || 0),
                },
              }),
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
}> {
  if (!acquireSyncLock(shopId)) {
    throw new Error(`Sync already in progress for shop ${shopId}`);
  }

  try {
    const [products, orders] = await Promise.all([
      syncShopeeProducts(shopId, userId),
      syncShopeeOrders(shopId, userId),
    ]);

    return { products, orders };
  } finally {
    releaseSyncLock(shopId);
  }
}
