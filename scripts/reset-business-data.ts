import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";
import { assertResetAllowed, getDatabaseTarget } from "./fresh-start-policy";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const includeMarketplace = process.argv.includes("--include-marketplace");
const resetTransactionOptions = { maxWait: 10_000, timeout: 120_000 };

const businessCollections = [
  "purchaseReceiptItem", "purchaseReceipt", "sourcingEvent", "sourcingQuote", "sourcingOrder", "sourcingCase",
  "purchaseOrderItem", "purchaseOrder", "workspaceMember",
  "invoice", "orderItem", "order", "productChannelMapping", "stockMovement", "stockAllocation", "stockTransfer", "product",
  "category", "supplier", "warehouse", "workspace", "importHistory", "supportTicketReply", "supportTicket", "productReview", "notification", "auditLog",
  "session", "permission", "stockAlert", "userAction", "verificationToken", "department",
] as const;
const marketplaceCollections = [
  "shopeeOrderItem", "shopeeOrder", "shopeeProductVariant", "shopeeProduct", "shopeeReturn", "shopeeAdsCampaignDailyPerformance", "shopeeAdsDailyPerformance", "shopeeSyncLog",
  "lazadaOrderItem", "lazadaOrder", "lazadaProductVariant", "lazadaProduct",
  "tikTokOrderItem", "tikTokOrder", "tikTokProductVariant", "tikTokProduct",
  "shopifyOrderItem", "shopifyOrder", "shopifyProductVariant", "shopifyProduct",
  "syncLog",
] as const;
const preservedCollections = [
  "user", "systemConfig", "notificationSetting", "shopeeShop", "lazadaShop", "tikTokShop", "shopifyShop",
] as const;
const marketplaceShops = ["shopeeShop", "lazadaShop", "tikTokShop", "shopifyShop"] as const;

type Collection = (typeof businessCollections)[number] | (typeof marketplaceCollections)[number];
type PreservedCollection = (typeof preservedCollections)[number];
type MarketplaceShop = (typeof marketplaceShops)[number];
type ResetDelegate = { count: (args?: unknown) => Promise<number>; deleteMany: (args: Record<string, never>) => Promise<{ count: number }> };
type MarketplaceShopDelegate = { count: (args?: unknown) => Promise<number>; updateMany: (args: unknown) => Promise<{ count: number }> };
const resetDelegates = prisma as unknown as Record<Collection | PreservedCollection, ResetDelegate>;
const marketplaceShopDelegates = prisma as unknown as Record<MarketplaceShop, MarketplaceShopDelegate>;

async function assertMongoTransactionsSupported(databaseUrl: string) {
  const client = new MongoClient(databaseUrl);
  let session: ReturnType<MongoClient["startSession"]> | undefined;
  try {
    await client.connect();
    session = client.startSession();
    session.startTransaction();
    // A read inside the transaction verifies that the server can actually start one.
    await client.db().collection("__fresh_start_transaction_probe").findOne({}, { session });
    await session.abortTransaction();
  } catch {
    throw new Error("Refusing reset: this MongoDB target does not support transactions. Use a replica set or sharded cluster, restore/prepare it safely, then retry.");
  } finally {
    await session?.endSession();
    await client.close();
  }
}

async function main() {
  const target = getDatabaseTarget(process.env.DATABASE_URL);
  assertResetAllowed(process.env, target, dryRun, includeMarketplace);
  const collections = includeMarketplace ? [...businessCollections, ...marketplaceCollections] : businessCollections;
  console.log(`\nFresh-start ${dryRun ? "dry run" : "reset"} target: ${target.display}`);
  console.log(`Mode: ${process.env.NODE_ENV || "unset"}${dryRun ? " (no records will be deleted)" : ""}`);
  console.log(`Marketplace snapshots: ${includeMarketplace ? "included; connected shop credentials/configuration will be retained" : "preserved (pass --include-marketplace to delete)"}\n`);

  const counts = await Promise.all(collections.map(async (collection) => [collection, await resetDelegates[collection].count()] as const));
  console.log(`${includeMarketplace ? "Deletion" : "Business-data"} collection counts:`);
  for (const [collection, count] of counts) console.log(`  ${collection}: ${count}`);
  if (includeMarketplace) {
    const syncStateCounts = await Promise.all(marketplaceShops.map(async (shop) => [shop, await marketplaceShopDelegates[shop].count({ where: { lastSyncedAt: { not: null } } })] as const));
    console.log("\nConnected shop sync-state fields to clear:");
    for (const [shop, count] of syncStateCounts) console.log(`  ${shop}.lastSyncedAt: ${count}`);
  }
  const preservedCounts = await Promise.all(preservedCollections.map(async (collection) => [collection, await resetDelegates[collection].count()] as const));
  console.log("\nPreserved credential/configuration collection counts:");
  for (const [collection, count] of preservedCounts) console.log(`  ${collection}: ${count}`);

  if (dryRun) return;

  await assertMongoTransactionsSupported(process.env.DATABASE_URL!);
  console.log(`\nDeleting ${includeMarketplace ? "business and marketplace snapshot" : "business"} data transactionally in dependency order:`);
  const deleted = await prisma.$transaction(async (transaction) => {
    const delegates = transaction as unknown as Record<Collection, ResetDelegate>;
    const shops = transaction as unknown as Record<MarketplaceShop, MarketplaceShopDelegate>;
    const results: [Collection, number][] = [];
    for (const collection of collections) results.push([collection, (await delegates[collection].deleteMany({})).count]);
    if (includeMarketplace) {
      for (const shop of marketplaceShops) {
        await shops[shop].updateMany({ where: { lastSyncedAt: { not: null } }, data: { lastSyncedAt: null } });
      }
    }
    return results;
  }, resetTransactionOptions);
  for (const [collection, count] of deleted) console.log(`  ${collection}: ${count}`);
  console.log(`\nReset complete. ${includeMarketplace ? "Marketplace snapshots and shop sync state were cleared; connected shop credentials/configuration were retained." : "Marketplace snapshots and shop sync state were preserved."} Run prisma db push, then prisma generate, only if the schema changed.\n`);
}

main()
  .catch((error) => {
    console.error(`Fresh-start reset failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
