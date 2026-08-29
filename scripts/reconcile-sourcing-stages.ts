/**
 * Realigns sourcing case stages with their linked purchase orders using the
 * weakest-link aggregate. Fixes legacy cases whose stage no longer matches the
 * PO statuses (e.g. one PO shipping while another is still approved).
 *
 * Usage: npx tsx scripts/reconcile-sourcing-stages.ts --dry-run
 *        npx tsx scripts/reconcile-sourcing-stages.ts --confirm
 */

import { prisma } from "@/prisma/client";
import { deriveSourcingCaseStage } from "@/lib/sourcing/case-stage";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  if (!dryRun && !confirmed) {
    throw new Error("Refusing reset: run with --dry-run first, then --confirm.");
  }
  const cases = await prisma.sourcingCase.findMany({
    where: {
      stage: { in: ["order_pending", "ordered", "shipping", "received"] },
    },
    select: {
      id: true,
      title: true,
      stage: true,
      orders: { include: { purchaseOrder: { select: { status: true } } } },
    },
  });
  const updates = cases.flatMap((item) => {
    const stage = deriveSourcingCaseStage(
      item.orders.map((order) => order.purchaseOrder?.status || ""),
    );
    return stage && stage !== item.stage
      ? [{ id: item.id, title: item.title, from: item.stage, to: stage }]
      : [];
  });
  console.log(
    JSON.stringify({ dryRun, scanned: cases.length, updates }, null, 2),
  );
  if (dryRun || !updates.length) return;
  await prisma.$transaction(
    updates.map((update) =>
      prisma.sourcingCase.update({
        where: { id: update.id },
        data: {
          stage: update.to,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      }),
    ),
  );
  console.log(`Reconciled ${updates.length} sourcing case(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
