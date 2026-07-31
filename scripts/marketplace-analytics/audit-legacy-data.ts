import { prisma } from "@/prisma/client";

async function audit() {
  const [tiktok, lazada, shopee, shopify, tiktokDuplicateIds, lazadaDuplicateIds, shopeeDuplicateIds, shopifyDuplicateIds, quality, capabilities, backfills, shopeeCurrencies, lazadaCurrencies, tiktokCurrencies, shopifyCurrencies, shopeeStatuses, lazadaStatuses, tiktokStatuses, shopifyStatuses] = await Promise.all([
    prisma.tikTokOrderItem.count(), prisma.lazadaOrderItem.count(), prisma.shopeeOrder.count(), prisma.shopifyOrder.count(),
    prisma.tikTokOrder.groupBy({ by: ["tiktokOrderId"], _count: true, having: { tiktokOrderId: { _count: { gt: 1 } } } }),
    prisma.lazadaOrder.groupBy({ by: ["lazadaOrderId"], _count: true, having: { lazadaOrderId: { _count: { gt: 1 } } } }),
    prisma.shopeeOrder.groupBy({ by: ["shopeeOrderId"], _count: true, having: { shopeeOrderId: { _count: { gt: 1 } } } }),
    prisma.shopifyOrder.groupBy({ by: ["shopifyOrderId"], _count: true, having: { shopifyOrderId: { _count: { gt: 1 } } } }),
    prisma.marketplaceFinancialRecord.groupBy({ by: ["platform", "financialQuality"], _count: true }),
    prisma.marketplaceAnalyticsCapability.groupBy({ by: ["platform", "state"], _count: true }),
    prisma.marketplaceAnalyticsBackfill.groupBy({ by: ["platform", "stream", "status"], _count: true }),
    prisma.shopeeOrder.groupBy({ by: ["currency"], _count: true }), prisma.lazadaOrder.groupBy({ by: ["currency"], _count: true }), prisma.tikTokOrder.groupBy({ by: ["currency"], _count: true }), prisma.shopifyOrder.groupBy({ by: ["currency"], _count: true }),
    prisma.shopeeOrder.groupBy({ by: ["orderStatus"], _count: true }), prisma.lazadaOrder.groupBy({ by: ["orderStatus"], _count: true }), prisma.tikTokOrder.groupBy({ by: ["orderStatus"], _count: true }), prisma.shopifyOrder.groupBy({ by: ["orderStatus"], _count: true }),
  ]);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rows: { tiktokItems: tiktok, lazadaItems: lazada, shopeeOrders: shopee, shopifyOrders: shopify }, duplicateExternalIds: { tiktok: tiktokDuplicateIds, lazada: lazadaDuplicateIds, shopee: shopeeDuplicateIds, shopify: shopifyDuplicateIds }, distributions: { currency: { shopee: shopeeCurrencies, lazada: lazadaCurrencies, tiktok: tiktokCurrencies, shopify: shopifyCurrencies }, status: { shopee: shopeeStatuses, lazada: lazadaStatuses, tiktok: tiktokStatuses, shopify: shopifyStatuses }, financialQuality: quality }, qualityCoverage: quality, capabilityObservability: capabilities, backfillObservability: backfills, orderIdMigrationGate: { status: "not-approved", limitation: "Global external-order unique constraints remain in place.", requiredBeforeChange: ["Run this duplicate audit against production", "Approve a scoped-index deployment after reviewing duplicates", "Prepare rollback by retaining global indexes until scoped uniqueness is verified"], rollback: "Restore global unique indexes and stop scoped writes if duplicate detection or sync reconciliation fails." }, note: "Read-only audit; no financial values or source semantics are inferred." }, null, 2));
}
audit().finally(() => prisma.$disconnect());
