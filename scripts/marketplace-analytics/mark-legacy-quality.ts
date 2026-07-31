import { prisma } from "@/prisma/client";

export function needsLegacyQualityMark(row: { createdAt: Date; sourceObservedAt: Date | null; qualityMarkedAt: Date | null }, cutoff: Date): boolean {
  return row.qualityMarkedAt === null && row.sourceObservedAt === null && row.createdAt < cutoff;
}

/** Safe to rerun: only rows that have never received a quality marker are changed. */
export async function markLegacyMarketplaceAnalyticsQuality(cutoff: Date) {
  if (Number.isNaN(cutoff.getTime())) throw new Error("A valid legacy cutoff date is required");
  const legacy = { qualityMarkedAt: null, sourceObservedAt: null, createdAt: { lt: cutoff } };
  const [tiktokOrders, tiktokItems, lazadaOrders, lazadaItems, shopeeOrders, shopifyOrders] = await Promise.all([
    prisma.tikTokOrder.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
    prisma.tikTokOrderItem.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
    prisma.lazadaOrder.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
    prisma.lazadaOrderItem.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
    prisma.shopeeOrder.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
    prisma.shopifyOrder.updateMany({ where: legacy, data: { financialQuality: "legacy-unverified", financialRevision: "legacy-v0", qualityMarkedAt: new Date() } }),
  ]);
  return { tiktokOrders: tiktokOrders.count, tiktokItems: tiktokItems.count, lazadaOrders: lazadaOrders.count, lazadaItems: lazadaItems.count, shopeeOrders: shopeeOrders.count, shopifyOrders: shopifyOrders.count };
}

if (require.main === module) {
  const cutoff = process.env.MARKETPLACE_ANALYTICS_LEGACY_CUTOFF;
  if (!cutoff) throw new Error("Set MARKETPLACE_ANALYTICS_LEGACY_CUTOFF (YYYY-MM-DD) before running this backfill");
  markLegacyMarketplaceAnalyticsQuality(new Date(`${cutoff}T00:00:00.000Z`)).then((result) => console.log(JSON.stringify(result))).finally(() => prisma.$disconnect());
}
