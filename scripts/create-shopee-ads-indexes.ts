/** Add indexes only for the new ads collections; no existing collections change. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  await prisma.$runCommandRaw({ createIndexes: "ShopeeAdsObservation", indexes: [
    { key: { shopId: 1, entityKey: 1, date: 1 }, name: "ShopeeAdsObservation_shopId_entityKey_date_key", unique: true },
    { key: { shopId: 1, reportType: 1, date: 1 }, name: "ShopeeAdsObservation_shopId_reportType_date_idx" },
  ] });
  await prisma.$runCommandRaw({ createIndexes: "ShopeeAdsCoverage", indexes: [
    { key: { shopId: 1, reportType: 1, dateFrom: 1, dateTo: 1 }, name: "ShopeeAdsCoverage_shopId_reportType_dateFrom_dateTo_key", unique: true },
    { key: { shopId: 1, dateFrom: 1, dateTo: 1 }, name: "ShopeeAdsCoverage_shopId_dateFrom_dateTo_idx" },
  ] });
  console.log("Shopee ads observation and coverage indexes are ready.");
}
main().catch((error) => { console.error("Ads index setup failed:", error.code ?? error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
