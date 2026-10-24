import { MongoClient, ObjectId, type AnyBulkWriteOperation, type Document } from "mongodb";
import { additiveMetrics, type AdsMetrics } from "./ads-metrics";

export type StoredAdsRow = {
  observation: {
    shopId: string; userId: string; entityKey: string; reportType: string;
    date: Date; metrics: AdsMetrics; [key: string]: unknown;
  };
  legacy: Record<string, unknown> | null;
};

let connection: Promise<MongoClient> | undefined;
async function database() {
  if (!connection) {
    const uri = process.env.DATABASE_URL;
    if (!uri) throw new Error("Ads database is not configured");
    connection = new MongoClient(uri, { maxPoolSize: 5 }).connect().catch((error) => { connection = undefined; throw error; });
  }
  return (await connection).db();
}

/** Bounded native batches avoid a read/transaction round-trip per Prisma upsert. */
export async function persistAdsRows(rows: StoredAdsRow[]) {
  if (!rows.length) return;
  const db = await database();
  const batches = new Map<string, AnyBulkWriteOperation<Document>[]>();
  const add = (collection: string, operation: AnyBulkWriteOperation<Document>) => {
    const batch = batches.get(collection) ?? []; batch.push(operation); batches.set(collection, batch);
  };
  for (const { observation, legacy } of rows) {
    const shopId = new ObjectId(observation.shopId); const userId = new ObjectId(observation.userId);
    const key = { shopId, entityKey: observation.entityKey, date: observation.date };
    // An explicit provider zero can remove a previously nonzero revision. Its
    // observation is retained by the successful date-range coverage record.
    const zero = observation.reportType === "product_campaign" && additiveMetrics.every((metric) => observation.metrics[metric] === 0);
    add("ShopeeAdsObservation", zero ? { deleteOne: { filter: key } } : { updateOne: { filter: key, update: { $set: { ...observation, shopId, userId } }, upsert: true } });
    if (legacy) {
      const collection = observation.reportType === "shop_cpc" ? "ShopeeAdsDailyPerformance" : "ShopeeAdsCampaignDailyPerformance";
      const filter = observation.reportType === "shop_cpc" ? { shopId, date: observation.date } : { shopId, campaignId: observation.campaignId, date: observation.date };
      add(collection, zero ? { deleteOne: { filter } } : { updateOne: { filter, update: { $set: { ...legacy, shopId, userId, date: observation.date } }, upsert: true } });
    }
  }
  for (const [name, operations] of batches) {
    for (let index = 0; index < operations.length; index += 500) {
      await db.collection(name).bulkWrite(operations.slice(index, index + 500), { ordered: false });
    }
  }
}
