/**
 * Shopee Excel Import
 * Parses Shopee Seller Center order export (.xlsx) and upserts orders + items.
 * Groups rows by Order ID (multiple items → one order).
 * Uses unmasked address data from the Excel export (Province, City, District, Town, Zip Code).
 */

import ExcelJS from "exceljs";
import prisma from "@/prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

// Shopee order status mapping (same as sync.ts)
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

// Map Shopee column headers to our field names
const COLUMN_MAP: Record<string, string> = {
  "Order ID": "orderId",
  "Order Type": "orderType",
  "Order Status": "orderStatus",
  "Hot Listing": "hotListing",
  "Return / Refund Status": "returnRefundStatus",
  "Tracking Number*": "trackingNumber",
  "Shipping Option": "shippingOption",
  "Shipment Method": "shipmentMethod",
  "Estimated Ship Out Date": "estimatedShipOutDate",
  "Ship Time": "shipTime",
  "Order Creation Date": "orderCreationDate",
  "Order Paid Time": "orderPaidTime",
  "Parent SKU Reference No.": "parentSku",
  "Product Name": "productName",
  "SKU Reference No.": "sku",
  "Variation Name": "variationName",
  "Original Price": "originalPrice",
  "Deal Price": "dealPrice",
  "Quantity": "quantity",
  "Returned quantity": "returnedQuantity",
  "Product Subtotal": "productSubtotal",
  "Seller Rebate": "sellerRebate",
  "Seller Discount": "sellerDiscount",
  "Shopee Rebate": "shopeeRebate",
  "SKU Total Weight": "skuTotalWeight",
  "No of product in order": "noOfProductsInOrder",
  "Order Total Weight": "orderTotalWeight",
  "Voucher Code": "voucherCode",
  "Discount Voucher Amount Sponsored by Seller": "sellerVoucherDiscount",
  "Coin Cashback Voucher Amount Sponsored by Seller": "sellerCoinCashback",
  "Discount Voucher Amount Sponsored by Shopee": "shopeeVoucherDiscount",
  "Bundle Deal Indicator": "bundleDealIndicator",
  "Shopee Bundle Discount": "shopeeBundleDiscount",
  "Seller Bundle Discount": "sellerBundleDiscount",
  "Coin Cashback Voucher Amount Sponsored by Shopee": "shopeeCoinCashback",
  "Credit Card Discount Total": "creditCardDiscount",
  "Total Amount": "totalAmount",
  "Buyer Paid Shipping Fee": "buyerPaidShippingFee",
  "Shipping Rebate Estimate": "shippingRebateEstimate",
  "Reverse Shipping Fee": "reverseShippingFee",
  "Transaction Fee": "transactionFee",
  "Commission Fee": "commissionFee",
  "Service Fee": "serviceFee",
  "Grand Total": "grandTotal",
  "Estimated Shipping Fee": "estimatedShippingFee",
  "Username (Buyer)": "buyerUsername",
  "Receiver Name": "receiverName",
  "Phone Number": "phoneNumber",
  "Delivery Address": "deliveryAddress",
  "Town": "town",
  "District": "district",
  "City": "city",
  "Province": "province",
  "Country": "country",
  "Zip Code": "zipCode",
  "Remark from buyer": "remarkFromBuyer",
  "Order Complete Time": "orderCompleteTime",
  "Note": "note",
};

/** Cast value to Prisma InputJsonValue for JSON fields */
function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Parse a Shopee date string like "2026-06-12 07:47" to Date */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  try {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

/** Parse a number from string, stripping commas and currency symbols */
function parseNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/[,\s$¥€£RM]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export interface ExcelOrderRow {
  orderId: string;
  orderType: string;
  orderStatus: string;
  hotListing: string;
  returnRefundStatus: string;
  trackingNumber: string;
  shippingOption: string;
  shipmentMethod: string;
  estimatedShipOutDate: string;
  shipTime: string;
  orderCreationDate: string;
  orderPaidTime: string;
  parentSku: string;
  productName: string;
  sku: string;
  variationName: string;
  originalPrice: string;
  dealPrice: string;
  quantity: string;
  returnedQuantity: string;
  productSubtotal: string;
  sellerRebate: string;
  sellerDiscount: string;
  shopeeRebate: string;
  skuTotalWeight: string;
  noOfProductsInOrder: string;
  orderTotalWeight: string;
  voucherCode: string;
  sellerVoucherDiscount: string;
  sellerCoinCashback: string;
  shopeeVoucherDiscount: string;
  bundleDealIndicator: string;
  shopeeBundleDiscount: string;
  sellerBundleDiscount: string;
  shopeeCoinCashback: string;
  creditCardDiscount: string;
  totalAmount: string;
  buyerPaidShippingFee: string;
  shippingRebateEstimate: string;
  reverseShippingFee: string;
  transactionFee: string;
  commissionFee: string;
  serviceFee: string;
  grandTotal: string;
  estimatedShippingFee: string;
  buyerUsername: string;
  receiverName: string;
  phoneNumber: string;
  deliveryAddress: string;
  town: string;
  district: string;
  city: string;
  province: string;
  country: string;
  zipCode: string;
  remarkFromBuyer: string;
  orderCompleteTime: string;
  note: string;
  [key: string]: string;
}

export interface ExcelImportResult {
  imported: number;
  orders: number;
  created: number;
  updated: number;
  itemsCreated: number;
  errors: string[];
  warnings: string[];
}

/**
 * Parse the Excel buffer into grouped order data.
 * Returns a Map of orderId → ExcelOrderRow[] (multiple items per order).
 */
export async function parseExcelOrderFile(
  data: ArrayBuffer | Buffer,
): Promise<{ orders: Map<string, ExcelOrderRow[]>; headers: string[]; totalRows: number }> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS declares its own `Buffer` type (TS5.6) which clashes with @types/node
  // generic Buffer in TS5.7+. Cast any through to satisfy both.
  await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    throw new Error("Excel file is empty or has no data rows");
  }

  // Read headers from first row
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value || "").trim();
  });

  // Map column numbers to our field names
  const colToField: Record<number, string> = {};
  for (let i = 1; i <= headers.length; i++) {
    const header = headers[i];
    if (header && COLUMN_MAP[header]) {
      colToField[i] = COLUMN_MAP[header];
    }
  }

  // Parse data rows
  const orders = new Map<string, ExcelOrderRow[]>();
  let totalRows = 0;

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);

    // Skip completely empty rows
    const firstCell = row.getCell(1).value;
    if (!firstCell) continue;

    totalRows++;

    const rowObj = {} as ExcelOrderRow;
    for (const [colStr, field] of Object.entries(colToField)) {
      const col = parseInt(colStr);
      const cell = row.getCell(col);
      const val = cell.value;
      // Handle dates from ExcelJS
      if (val instanceof Date) {
        rowObj[field] = val.toISOString();
      } else if (typeof val === "object" && val !== null && "result" in val) {
        // Formula result
        rowObj[field] = String((val as { result: unknown }).result ?? "");
      } else {
        rowObj[field] = String(val ?? "").trim();
      }
    }

    const orderId = rowObj.orderId;
    if (!orderId) continue;

    if (!orders.has(orderId)) {
      orders.set(orderId, []);
    }
    orders.get(orderId)!.push(rowObj);
  }

  return { orders, headers, totalRows };
}

/**
 * Import parsed Excel orders into the database.
 * Groups rows by Order ID → one ShopeeOrder per group, with multiple ShopeeOrderItem rows.
 */
export async function importExcelOrders(
  orders: Map<string, ExcelOrderRow[]>,
  shopId: string,
  userId: string,
  actorId = userId,
): Promise<ExcelImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let imported = 0;
  let orderCount = 0;
  let created = 0;
  let updated = 0;
  let itemsCreated = 0;

  // Verify the shop exists and user owns it
  const shop = await prisma.shopeeShop.findFirst({
    where: { id: shopId, userId },
  });
  if (!shop) {
    throw new Error("Shopee shop not found or you don't have access");
  }

  // Create sync log
  const syncLog = await prisma.shopeeSyncLog.create({
    data: {
      shopId: shop.id,
      userId: actorId,
      syncType: "orders",
      status: "running",
      triggeredBy: "excel_import",
    },
  });

  try {
    for (const [orderId, rows] of orders) {
      try {
        const firstRow = rows[0];
        if (!firstRow) continue;

        // Build shipping address from unmasked Excel data
        const shippingAddress = {
          name: firstRow.receiverName || "",
          phone: firstRow.phoneNumber || "",
          full_address: firstRow.deliveryAddress || "",
          town: firstRow.town || "",
          district: firstRow.district || "",
          city: firstRow.city || "",
          state: firstRow.province || "",
          region: firstRow.country || "MY",
          zipcode: firstRow.zipCode || "",
        };

        // Determine order status
        const rawStatus = (firstRow.orderStatus || "").toUpperCase();
        const orderStatus = ORDER_STATUS_MAP[rawStatus] || rawStatus.toLowerCase() || "pending";
        const paymentStatus = PAYMENT_STATUS_MAP[rawStatus] || "unpaid";

        // Calculate total amount from first row (same for all items in the order)
        const totalAmount = parseNum(firstRow.totalAmount);

        // Fee fields (same for all items in the order)
        const commissionFee = parseNum(firstRow.commissionFee);
        const serviceFee = parseNum(firstRow.serviceFee);
        const sellerTxnFee = parseNum(firstRow.transactionFee);
        const shippingFee = parseNum(firstRow.buyerPaidShippingFee);
        const sellerIncome = parseNum(firstRow.grandTotal);

        // Date fields
        const shopeeCreatedAt = parseDate(firstRow.orderCreationDate);
        const shopeeUpdatedAt = parseDate(firstRow.shipTime) || shopeeCreatedAt;
        const paidAt = parseDate(firstRow.orderPaidTime);
        const shippedAt = parseDate(firstRow.shipTime);
        const completedAt = parseDate(firstRow.orderCompleteTime);

        // Check if order already exists
        const existing = await prisma.shopeeOrder.findFirst({
          where: { shopId: shop.id, shopeeOrderId: orderId },
        });

        const orderData = {
          shopId: shop.id,
          userId,
          shopeeOrderId: orderId,
          orderStatus,
          paymentStatus,
          totalAmount,
          currency: "MYR",
          region: firstRow.country || "MY",
          buyerUsername: firstRow.buyerUsername || "",
          buyerEmail: "",
          shippingAddress: toInputJson(shippingAddress),
          trackingNumber: firstRow.trackingNumber || "",
          trackingCarrier: firstRow.shippingOption || "",
          logisticsStatus: "",
          shopeeCreatedAt,
          shopeeUpdatedAt,
          paidAt,
          shippedAt,
          completedAt,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actorId,
          commissionFee,
          serviceFee,
          sellerTxnFee,
          shippingFee,
          sellerIncome,
          financialQuality: "unknown",
          financialRevision: "source-v1",
          qualityMarkedAt: new Date(),
          sourceObservedAt: new Date(),
          buyerPaymentMethod: "",
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

        // Delete existing items and recreate from Excel
        await prisma.shopeeOrderItem.deleteMany({
          where: { orderId: orderRecord.id },
        });

        // Create order items from each Excel row
        for (const row of rows) {
          const qty = parseInt(row.quantity) || 1;
          const price = parseNum(row.dealPrice);
          const subtotal = parseNum(row.productSubtotal) || qty * price;

          // Build product name with variation
          let productName = row.productName || "";
          if (row.variationName) {
            productName += ` - ${row.variationName}`;
          }

          await prisma.shopeeOrderItem.create({
            data: {
              orderId: orderRecord.id,
              shopeeModelId: 0,
              productName,
              sku: row.sku || "",
              quantity: qty,
              price,
              subtotal,
            },
          });
          itemsCreated++;
        }

        orderCount++;
        imported += rows.length;
      } catch (itemError) {
        const msg = `Failed to import order ${orderId}: ${itemError instanceof Error ? itemError.message : String(itemError)}`;
        errors.push(msg);
        logger.warn(`[Shopee Excel Import] ${msg}`);
      }
    }

    // Update sync log
    await prisma.shopeeSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        itemsSynced: imported,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      },
    });

    // Update shop last synced
    await prisma.shopeeShop.update({
      where: { id: shop.id },
      data: { lastSyncedAt: new Date(), updatedAt: new Date() },
    });

    logger.info(
      `[Shopee Excel Import] Done: ${orderCount} orders, ${itemsCreated} items (created: ${created}, updated: ${updated}, errors: ${errors.length})`,
    );

    return { imported, orders: orderCount, created, updated, itemsCreated, errors, warnings };
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
