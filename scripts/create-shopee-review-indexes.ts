/** Add only review-collection indexes; no existing collections are migrated. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.$runCommandRaw({ createIndexes: "ShopeeReview", indexes: [
    { key: { shopId: 1, externalId: 1 }, name: "ShopeeReview_shopId_externalId_key", unique: true },
    { key: { shopId: 1, sourceCreatedAt: 1, _id: 1 }, name: "ShopeeReview_shopId_sourceCreatedAt_id_idx" },
    { key: { shopId: 1, itemExternalId: 1, sourceCreatedAt: 1 }, name: "ShopeeReview_shopId_itemExternalId_sourceCreatedAt_idx" },
    { key: { shopId: 1, linkCheckedAt: 1 }, name: "ShopeeReview_shopId_linkCheckedAt_idx" },
  ] });
  await prisma.$runCommandRaw({ createIndexes: "ShopeeReviewCollection", indexes: [{ key: { shopId: 1, scopeKey: 1 }, name: "ShopeeReviewCollection_shopId_scopeKey_key", unique: true }] });
  console.log("Shopee review indexes are ready.");
}
main().catch((error) => { console.error("Review index setup failed:", error.code ?? error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
