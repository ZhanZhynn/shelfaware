import { MongoClient } from "mongodb";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const client = new MongoClient(url);
  await client.connect();
  try {
    const selections = client.db().collection("SourcingVariantSelection");
    const indexes = await selections.indexes();
    const quoteLineIndex = indexes.find(
      (index) =>
        Object.keys(index.key).length === 1 && index.key.quoteLineId === 1,
    );
    if (
      quoteLineIndex?.partialFilterExpression &&
      quoteLineIndex.unique === true
    ) {
      console.log("SourcingVariantSelection quoteLineId index is already partial; nothing to do.");
      return;
    }
    if (quoteLineIndex?.name) await selections.dropIndex(quoteLineIndex.name);

    // A non-sparse unique index lets only one document omit quoteLineId, so
    // confirming selections with multiple skipped variants fails. Restrict
    // uniqueness to documents that actually carry a quote line reference.
    await selections.createIndex(
      { quoteLineId: 1 },
      {
        unique: true,
        name: "SourcingVariantSelection_quoteLineId_key",
        partialFilterExpression: { quoteLineId: { $type: "string" } },
      },
    );
    console.log("SourcingVariantSelection quoteLineId uniqueness now applies only to non-null values.");
  } finally {
    await client.close();
  }
}

void main();
