/** Add only operational SLA indexes. Never changes existing marketplace collections. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  await prisma.$runCommandRaw({ createIndexes: "MarketplaceSlaUnit", indexes: [
    { key: { platform: 1, shopId: 1, unitKey: 1 }, name: "MarketplaceSlaUnit_platform_shopId_unitKey_key", unique: true },
    { key: { platform: 1, shopId: 1, stage: 1, deadlineAt: 1 }, name: "MarketplaceSlaUnit_platform_shopId_stage_deadlineAt_idx" },
    { key: { platform: 1, shopId: 1, sourceRunId: 1 }, name: "MarketplaceSlaUnit_platform_shopId_sourceRunId_idx" },
    { key: { platform: 1, shopId: 1, orderExternalId: 1 }, name: "MarketplaceSlaUnit_platform_shopId_orderExternalId_idx" },
  ] });
  await prisma.$runCommandRaw({ createIndexes: "MarketplaceSlaCollection", indexes: [
    { key: { platform: 1, shopId: 1 }, name: "MarketplaceSlaCollection_platform_shopId_key", unique: true },
  ] });
  console.log("Marketplace SLA indexes are ready.");
}
main().catch((error) => { console.error("SLA index setup failed:", error.code ?? error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
