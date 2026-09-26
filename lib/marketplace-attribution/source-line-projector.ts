import prisma from "@/prisma/client";
import type { Prisma } from "@prisma/client";
import { resolveShopeeProductId } from "./shopee-identity";
import { upsertShopeeOfferForItem } from "./offer-adapter";
import { isCancelledStatus, isUnpaidStatus } from "./order-status";
import { projectFactsForSourceLines } from "./fact-projector";

export type SourceLineInput = {
  platform: "shopee";
  internalShopId: string;
  externalOrderId: string;
  externalLineId: string;
  offerId?: string | null;
  sellerSku?: string | null;
  productName?: string | null;
  orderDate: Date;
  marketplaceQuantity?: number | null;
  grossItemSalesMinor?: string | null;
  amountScale: number;
  currency: string;
  orderStatus?: string | null;
  orderEligibility: string;
  quantityQuality: string;
  gmvQuality: string;
  sourceRevision?: string | null;
  sourceObservedAt?: Date;
};

export async function projectSourceLinesFromShopeeOrderItems(
  shopId: string,
  from?: Date,
  to?: Date,
  orderIds?: string[],
  skipExisting = false,
) {
  const where: Record<string, unknown> = {
    order: {
      shopId,
      ...(orderIds?.length ? { shopeeOrderId: { in: orderIds } } : {}),
      shopeeCreatedAt: from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined,
    },
  };

  const items = await prisma.shopeeOrderItem.findMany({
    where,
    include: {
      order: { select: { shopId: true, shopeeOrderId: true, orderStatus: true, currency: true, shopeeCreatedAt: true } },
      variant: { select: { shopeeItemId: true } },
    },
  });

  const products = await prisma.shopeeProduct.findMany({
    where: { shopId, variants: { none: {} } },
    select: { shopeeItemId: true, itemSku: true },
  });
  const existingLineIds = skipExisting && items.length > 0
    ? new Set((await prisma.marketplaceSourceSalesLine.findMany({
        where: {
          platform: "shopee",
          internalShopId: shopId,
          externalLineId: { in: items.map((item) => `${item.order.shopeeOrderId}:${item.id}`) },
        },
        select: { externalLineId: true },
      })).map((line) => line.externalLineId))
    : new Set<string>();

  const results = { created: 0, updated: 0, skipped: 0, total: items.length };

  const writeBatchSize = 25;
  for (let offset = 0; offset < items.length; offset += writeBatchSize) {
    await Promise.all(items.slice(offset, offset + writeBatchSize).map(async (item) => {
    const occurredAt = item.order.shopeeCreatedAt;
    if (!occurredAt) { results.skipped++; return; }

    const orderStatus = item.order.orderStatus;
    const isCancelled = isCancelledStatus(orderStatus);
    const isUnpaid = isUnpaidStatus(orderStatus);

    let eligibility = "eligible";
    if (isCancelled) eligibility = "ineligible";
    else if (isUnpaid) eligibility = "ineligible";

    const legacyNonvariant = item.shopeeModelId == null || item.shopeeModelId === 0;
    const productId = item.shopeeItemId ?? item.variant?.shopeeItemId ?? (legacyNonvariant ? resolveShopeeProductId(item, products) : null);

    let offerId: string | null = null;
    if (productId != null) {
      const modelId = item.shopeeModelId;
      const offer = await upsertShopeeOfferForItem(shopId, productId, modelId);
      if (offer) offerId = offer.id;
    }

    const currency = item.order.currency ?? "MYR";
    const scale = currencyScale(currency);
    const grossMinor = item.subtotal != null ? toMinorUnits(item.subtotal, currency) : null;

    // Using item.id as the line-level identity within the order. This is safe
    // for Shopee because item IDs are stable within an order — Shopee assigns
    // a unique row per line-item and does not recycle IDs within an order. If
    // Shopee ever reuses or mutates item IDs (e.g. partial returns creating
    // new item rows), this key would need to incorporate a hash of stable
    // line attributes (SKU + quantity + price) instead.
    const externalLineId = `${item.order.shopeeOrderId}:${item.id}`;
    if (existingLineIds.has(externalLineId)) { results.skipped++; return; }
    const sourceRevision = item.order.shopeeOrderId;

    const data: SourceLineInput = {
      platform: "shopee",
      internalShopId: shopId,
      externalOrderId: item.order.shopeeOrderId,
      externalLineId,
      offerId,
      sellerSku: item.sku ?? null,
      productName: item.productName ?? null,
      orderDate: occurredAt,
      marketplaceQuantity: item.quantity,
      grossItemSalesMinor: grossMinor?.toString() ?? null,
      amountScale: scale,
      currency,
      orderStatus,
      orderEligibility: eligibility,
      quantityQuality: item.quantity != null ? "observed" : "unknown",
      gmvQuality: grossMinor != null ? "observed" : "unknown",
      sourceRevision,
      sourceObservedAt: new Date(),
    };

    await prisma.marketplaceSourceSalesLine.upsert({
      where: {
        platform_internalShopId_externalOrderId_externalLineId: {
          platform: data.platform,
          internalShopId: data.internalShopId,
          externalOrderId: data.externalOrderId,
          externalLineId: data.externalLineId,
        },
      },
      create: data,
      update: {
        offerId: data.offerId,
        sellerSku: data.sellerSku,
        productName: data.productName,
        marketplaceQuantity: data.marketplaceQuantity,
        grossItemSalesMinor: data.grossItemSalesMinor,
        amountScale: data.amountScale,
        currency: data.currency,
        orderStatus: data.orderStatus,
        orderEligibility: data.orderEligibility,
        quantityQuality: data.quantityQuality,
        gmvQuality: data.gmvQuality,
        sourceRevision: data.sourceRevision,
        sourceObservedAt: data.sourceObservedAt,
        updatedAt: new Date(),
      },
    });
    // Prisma upsert does not report whether it inserted or updated. Counting
    // every durable write as updated avoids a per-line read that made historical
    // backfills exceed Mongo and HTTP execution limits.
    results.updated++;
    }));
  }

  return results;
}

/**
 * Project the order lines just synchronized, rather than repeatedly replaying
 * every order in the sync window. Raw order sync remains authoritative; failed
 * analytics projection is safe to retry because source and fact writes upsert.
 */
export async function projectShopeeAttributionForOrderIds(shopId: string, orderIds: string[]) {
  if (!orderIds.length) return { sourceLines: { created: 0, updated: 0, skipped: 0, total: 0 }, offerFacts: 0, salesSkuFacts: 0, wmsFacts: 0, skipped: 0 };
  const sourceLines = await projectSourceLinesFromShopeeOrderItems(shopId, undefined, undefined, orderIds);
  const lines = await prisma.marketplaceSourceSalesLine.findMany({
    where: { platform: "shopee", internalShopId: shopId, externalOrderId: { in: orderIds }, orderEligibility: "eligible" },
    select: { id: true },
  });
  const result = { offerFacts: 0, salesSkuFacts: 0, wmsFacts: 0, skipped: 0 };
  const batchSize = 200;
  for (let offset = 0; offset < lines.length; offset += batchSize) {
    const batch = await projectFactsForSourceLines(lines.slice(offset, offset + batchSize).map((line) => line.id));
    result.offerFacts += batch.offerFacts;
    result.salesSkuFacts += batch.salesSkuFacts;
    result.wmsFacts += batch.wmsFacts;
    result.skipped += batch.skipped;
  }
  return { sourceLines, ...result };
}

const currencyScale = (currency: string) =>
  ({ JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3 }[currency.toUpperCase()] ?? 2);

const toMinorUnits = (value: number, currency: string) =>
  BigInt(Math.round(value * 10 ** currencyScale(currency)));
