import { prisma } from "@/prisma/client";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const orders = await prisma.sourcingOrder.findMany({
    include: { purchaseOrder: true },
  });
  const quoteIds = orders.map((order) => order.quoteId);
  const quotes = quoteIds.length
    ? await prisma.sourcingQuote.findMany({ where: { id: { in: quoteIds } }, select: { id: true, currency: true } })
    : [];
  const currencies = new Map(quotes.map((quote) => [quote.id, quote.currency]));
  const updates = orders.flatMap((order) => {
    const currency = currencies.get(order.quoteId);
    if (!order.purchaseOrder || !currency || order.purchaseOrder.currency === currency) return [];
    return [{ id: order.purchaseOrder.id, poNumber: order.purchaseOrder.poNumber, from: order.purchaseOrder.currency, to: currency }];
  });

  console.log(JSON.stringify({ dryRun, sourcingOrders: orders.length, purchaseOrdersToUpdate: updates.length, updates }, null, 2));
  if (dryRun || updates.length === 0) return;
  await prisma.$transaction(updates.map((update) => prisma.purchaseOrder.update({
    where: { id: update.id },
    data: { currency: update.to },
  })));
  console.log(`Updated ${updates.length} sourcing purchase-order currency records.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
