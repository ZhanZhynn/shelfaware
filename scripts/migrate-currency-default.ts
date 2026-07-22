import { prisma } from "@/prisma/client";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const [workspaces, config] = await Promise.all([
    prisma.workspace.count(),
    prisma.systemConfig.findUnique({ where: { key: "currency" }, select: { value: true } }),
  ]);

  console.log(JSON.stringify({ dryRun, workspacesToSetMyr: workspaces, systemCurrency: config?.value ?? null }, null, 2));
  if (dryRun) return;

  await prisma.$transaction([
    prisma.workspace.updateMany({
      where: {},
      data: { baseCurrency: "MYR", locale: "en-MY", updatedAt: new Date() },
    }),
    prisma.systemConfig.upsert({
      where: { key: "currency" },
      create: {
        key: "currency",
        value: "MYR",
        type: "string",
        label: "Currency",
        description: "Default currency for prices and transactions (MYR)",
        category: "payment",
        isPublic: true,
        createdAt: new Date(),
      },
      update: { value: "MYR", updatedAt: new Date() },
    }),
  ]);
  console.log("Migrated workspace and system defaults to MYR. Existing numeric amounts were not changed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
