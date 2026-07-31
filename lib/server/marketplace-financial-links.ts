import "server-only";

import prisma from "@/prisma/client";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

export type MarketplaceFinancialLinkResult = {
  linked: number;
  unmatched: number;
  notApplicable: number;
};

type FinancialRecord = { id: string; orderExternalId: string | null };
type PlatformOrder = { id: string; externalId: string };

async function ordersForPlatform(platform: MarketplacePlatform, shopId: string, orderExternalIds: string[]): Promise<PlatformOrder[]> {
  if (platform === "lazada") {
    return prisma.lazadaOrder.findMany({ where: { shopId, lazadaOrderId: { in: orderExternalIds } }, select: { id: true, lazadaOrderId: true } }).then((orders) => orders.map((order) => ({ id: order.id, externalId: order.lazadaOrderId })));
  }
  if (platform === "tiktok") {
    return prisma.tikTokOrder.findMany({ where: { shopId, tiktokOrderId: { in: orderExternalIds } }, select: { id: true, tiktokOrderId: true } }).then((orders) => orders.map((order) => ({ id: order.id, externalId: order.tiktokOrderId })));
  }
  if (platform === "shopify") {
    return prisma.shopifyOrder.findMany({ where: { shopId, shopifyOrderId: { in: orderExternalIds } }, select: { id: true, shopifyOrderId: true } }).then((orders) => orders.map((order) => ({ id: order.id, externalId: order.shopifyOrderId })));
  }
  return prisma.shopeeOrder.findMany({ where: { shopId, shopeeOrderId: { in: orderExternalIds } }, select: { id: true, shopeeOrderId: true } }).then((orders) => orders.map((order) => ({ id: order.id, externalId: order.shopeeOrderId })));
}

/** Links finance rows only through provider-native order IDs within the selected shop. */
export async function linkMarketplaceFinancialRecords(platform: MarketplacePlatform, shopId: string): Promise<MarketplaceFinancialLinkResult> {
  const records: FinancialRecord[] = await prisma.marketplaceFinancialRecord.findMany({
    where: { platform, shopId },
    select: { id: true, orderExternalId: true },
  });
  const orderExternalIds = [...new Set(records.flatMap((record) => record.orderExternalId ? [record.orderExternalId] : []))];
  const orders = orderExternalIds.length ? await ordersForPlatform(platform, shopId, orderExternalIds) : [];
  const ordersByExternalId = new Map(orders.map((order) => [order.externalId, order.id]));
  const result: MarketplaceFinancialLinkResult = { linked: 0, unmatched: 0, notApplicable: 0 };

  // Finance backfills can contain thousands of rows; keep database concurrency bounded.
  for (let offset = 0; offset < records.length; offset += 50) {
    await Promise.all(records.slice(offset, offset + 50).map(async (record) => {
      if (!record.orderExternalId) {
        result.notApplicable += 1;
        return prisma.marketplaceFinancialRecord.update({ where: { id: record.id }, data: { orderInternalId: null, orderLinkState: "not_applicable" } });
      }
      const orderInternalId = ordersByExternalId.get(record.orderExternalId);
      if (!orderInternalId) {
        result.unmatched += 1;
        return prisma.marketplaceFinancialRecord.update({ where: { id: record.id }, data: { orderInternalId: null, orderLinkState: "unmatched" } });
      }
      result.linked += 1;
      return prisma.marketplaceFinancialRecord.update({ where: { id: record.id }, data: { orderInternalId, orderLinkState: "linked" } });
    }));
  }

  return result;
}
