import prisma from "@/prisma/client";
import type { Prisma } from "@prisma/client";
import { resolveShopeeProductId } from "./shopee-identity";
import { upsertShopeeOfferForItem, shopeeIdentityKey } from "./offer-adapter";
import { isCancelledStatus, isUnpaidStatus } from "./order-status";

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
) {
  const where: Record<string, unknown> = {
    order: {
      shopId,
      shopeeCreatedAt: from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined,
    },
  };

  const items = await prisma.shopeeOrderItem.findMany({
    where,
    include: {
      order: { select: { shopId: true, shopeeOrderId: true, orderStatus: true, currency: true, shopeeCreatedAt: true } },
      variant: { select: { shopeeItemId: true } },
    },
    orderBy: { order: { shopeeCreatedAt: "asc" } },
  });

  const products = await prisma.shopeeProduct.findMany({
    where: { shopId, variants: { none: {} } },
    select: { shopeeItemId: true, itemSku: true },
  });

  const results = { created: 0, updated: 0, skipped: 0, total: items.length };

  for (const item of items) {
    const occurredAt = item.order.shopeeCreatedAt;
    if (!occurredAt) { results.skipped++; continue; }

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

    const existing = await prisma.marketplaceSourceSalesLine.findUnique({
      where: {
        platform_internalShopId_externalOrderId_externalLineId: {
          platform: data.platform,
          internalShopId: data.internalShopId,
          externalOrderId: data.externalOrderId,
          externalLineId: data.externalLineId,
        },
      },
      select: { createdAt: true, updatedAt: true },
    });

    if (existing && existing.updatedAt && existing.updatedAt > existing.createdAt) {
      results.updated++;
    } else {
      results.created++;
    }
  }

  return results;
}

const currencyScale = (currency: string) =>
  ({ JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3 }[currency.toUpperCase()] ?? 2);

const toMinorUnits = (value: number, currency: string) =>
  BigInt(Math.round(value * 10 ** currencyScale(currency)));
