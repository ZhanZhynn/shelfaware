import { MongoClient } from "mongodb";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const dryRun = process.argv.includes("--dry-run");
  const client = new MongoClient(url);
  await client.connect();
  try {
    const database = client.db();
    const [cases, templates] = await Promise.all([
      database.collection("sourcingCase").countDocuments({ route: { $exists: true } }),
      database.collection("sourcingTemplate").countDocuments({ "data.route": { $exists: true } }),
    ]);
    if (dryRun) {
      console.log(`Would remove route from ${cases} sourcing cases and ${templates} sourcing templates.`);
      return;
    }
    await Promise.all([
      database.collection("sourcingCase").updateMany({ route: { $exists: true } }, { $unset: { route: "" } }),
      database.collection("sourcingTemplate").updateMany({ "data.route": { $exists: true } }, { $unset: { "data.route": "" } }),
    ]);
    console.log(`Removed route from ${cases} sourcing cases and ${templates} sourcing templates.`);
  } finally {
    await client.close();
  }
}

void main();
