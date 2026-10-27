/** Add only the new OAuth-attempt indexes; no existing collections are migrated. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.$runCommandRaw({ createIndexes: "MarketplaceOAuthAttempt", indexes: [
    { key: { stateHash: 1 }, name: "MarketplaceOAuthAttempt_stateHash_key", unique: true },
    { key: { expiresAt: 1 }, name: "MarketplaceOAuthAttempt_expiresAt_idx" },
    { key: { userId: 1, provider: 1, createdAt: 1 }, name: "MarketplaceOAuthAttempt_userId_provider_createdAt_idx" },
  ] });
  console.log("Marketplace OAuth-attempt indexes are ready.");
}
main().catch((error) => { console.error("OAuth index setup failed:", error.code ?? error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
