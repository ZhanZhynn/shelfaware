import { prisma } from "@/prisma/client";

/** Read-only remediation inventory. Apply no database changes until reviewed. */
async function main() {
  const [shopee, lazadaOrders, lazadaItems, tiktokOrders, tiktokItems, shopify] = await Promise.all([
    prisma.shopeeOrder.count({ where: { rawFinancialPayload: { not: null } } }),
    prisma.lazadaOrder.count({ where: { rawFinancialPayload: { not: null } } }),
    prisma.lazadaOrderItem.count({ where: { rawFinancialPayload: { not: null } } }),
    prisma.tikTokOrder.count({ where: { rawFinancialPayload: { not: null } } }),
    prisma.tikTokOrderItem.count({ where: { rawFinancialPayload: { not: null } } }),
    prisma.shopifyOrder.count({ where: { rawFinancialPayload: { not: null } } }),
  ]);
  console.log(JSON.stringify({ mode: "dry-run", action: "sanitize existing rawFinancialPayload values with sanitizeMarketplaceRawPayload after backup and approval", records: { shopee, lazadaOrders, lazadaItems, tiktokOrders, tiktokItems, shopify } }, null, 2));
}

main().finally(() => prisma.$disconnect());
