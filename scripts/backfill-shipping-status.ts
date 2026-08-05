/**
 * Migrates legacy sourcing purchase-order and case statuses from shipped to shipping.
 * Usage: npm run script:backfill-shipping-status
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfillShippingStatus() {
  try {
    const [purchaseOrders, sourcingCases] = await prisma.$transaction([
      prisma.purchaseOrder.updateMany({
        where: { status: "shipped" },
        data: { status: "shipping" },
      }),
      prisma.sourcingCase.updateMany({
        where: { stage: "shipped" },
        data: { stage: "shipping" },
      }),
    ]);

    console.log(`Updated ${purchaseOrders.count} purchase order(s).`);
    console.log(`Updated ${sourcingCases.count} sourcing case(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

backfillShippingStatus().catch((error) => {
  console.error("Shipping status backfill failed:", error);
  process.exitCode = 1;
});
