/**
 * Deletes all sourcing cases and their direct records, including linked purchase
 * orders, receipts, and supplier evaluations. Products and inventory balances are
 * intentionally preserved because they can be shared with non-sourcing activity.
 *
 * Usage: npx tsx scripts/reset-sourcing-data.ts --dry-run
 *        npx tsx scripts/reset-sourcing-data.ts --confirm
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm");

async function main() {
  if (!dryRun && !confirmed) {
    throw new Error("Refusing reset: run with --dry-run first, then --confirm.");
  }

  const cases = await prisma.sourcingCase.findMany({ select: { id: true } });
  const caseIds = cases.map((item) => item.id);
  const sourcingOrders = caseIds.length
    ? await prisma.sourcingOrder.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true, purchaseOrderId: true },
      })
    : [];
  const purchaseOrderIds = sourcingOrders.flatMap((order) =>
    order.purchaseOrderId ? [order.purchaseOrderId] : [],
  );
  const receipts = purchaseOrderIds.length
    ? await prisma.purchaseReceipt.findMany({
        where: { purchaseOrderId: { in: purchaseOrderIds } },
        select: { id: true },
      })
    : [];
  const receiptIds = receipts.map((receipt) => receipt.id);
  const quoteIds = caseIds.length
    ? (await prisma.sourcingQuote.findMany({
        where: { caseId: { in: caseIds } },
        select: { id: true },
      })).map((quote) => quote.id)
    : [];

  const counts = {
    sourcingCases: caseIds.length,
    sourcingOrders: sourcingOrders.length,
    purchaseOrders: purchaseOrderIds.length,
    purchaseReceipts: receiptIds.length,
    sourcingAttachments: caseIds.length
      ? await prisma.sourcingAttachment.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingEvents: caseIds.length
      ? await prisma.sourcingEvent.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingComments: caseIds.length
      ? await prisma.sourcingComment.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingQuotes: quoteIds.length,
    sourcingQuoteLines: quoteIds.length
      ? await prisma.sourcingQuoteLine.count({ where: { quoteId: { in: quoteIds } } })
      : 0,
    sourcingVariants: caseIds.length
      ? await prisma.sourcingCaseVariant.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingSelections: caseIds.length
      ? await prisma.sourcingVariantSelection.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingSlaRecords: caseIds.length
      ? await prisma.sourcingSlaRecord.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingReminders: caseIds.length
      ? await prisma.sourcingReminder.count({ where: { caseId: { in: caseIds } } })
      : 0,
    sourcingCostScenarios: caseIds.length
      ? await prisma.sourcingCostScenario.count({ where: { caseId: { in: caseIds } } })
      : 0,
    purchaseOrderItems: purchaseOrderIds.length
      ? await prisma.purchaseOrderItem.count({ where: { purchaseOrderId: { in: purchaseOrderIds } } })
      : 0,
    purchaseReceiptItems: receiptIds.length
      ? await prisma.purchaseReceiptItem.count({ where: { purchaseReceiptId: { in: receiptIds } } })
      : 0,
    supplierEvaluations: purchaseOrderIds.length
      ? await prisma.supplierEvaluation.count({ where: { purchaseOrderId: { in: purchaseOrderIds } } })
      : 0,
  };
  console.log(JSON.stringify({ dryRun, counts }, null, 2));
  if (dryRun || !caseIds.length) return;

  await prisma.$transaction(async (tx) => {
    await tx.purchaseReceiptItem.deleteMany({ where: { purchaseReceiptId: { in: receiptIds } } });
    await tx.purchaseReceipt.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.supplierEvaluation.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.sourcingSlaRecord.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingReminder.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingCostScenario.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingAttachment.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingEvent.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingComment.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingVariantSelection.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingQuoteLine.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await tx.sourcingQuote.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingCaseVariant.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.sourcingOrder.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });
    await tx.sourcingCase.deleteMany({ where: { id: { in: caseIds } } });
  });
  console.log("Sourcing reset complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
