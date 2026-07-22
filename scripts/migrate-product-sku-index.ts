import { MongoClient } from "mongodb";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const client = new MongoClient(url);
  await client.connect();
  try {
    const products = client.db().collection("Product");
    const indexes = await products.indexes();
    const obsoleteIndexes = indexes.filter((index) =>
      index.name && (
        (Object.keys(index.key).length === 1 && index.key.sku === 1) ||
        (index.key.workspaceId === 1 && index.key.sku === 1)
      ),
    );
    for (const index of obsoleteIndexes) await products.dropIndex(index.name!);

    // A non-null scope avoids MongoDB's single-null entry in a unique compound index.
    await products.updateMany(
      { skuScopeId: { $exists: false } },
      [{ $set: { skuScopeId: { $ifNull: ["$workspaceId", "$userId"] } } }],
    );
    await products.createIndex({ skuScopeId: 1, sku: 1 }, { unique: true, name: "Product_skuScopeId_sku_key" });
    console.log("Product SKU uniqueness is scoped to workspaceId or legacy owner userId.");
  } finally {
    await client.close();
  }
}

void main();
