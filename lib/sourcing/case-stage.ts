import type { Prisma } from "@prisma/client";

/**
 * Weakest-link aggregate for a sourcing case: the request advances only when
 * every linked purchase order passes the stage. A single unplaced PO keeps the
 * case in order_pending; a single unshipped PO keeps it in ordered.
 */
export function deriveSourcingCaseStage(poStatuses: string[]): string | null {
  const active = poStatuses.filter((status) => status && status !== "cancelled");
  if (!active.length) return null;
  if (active.includes("approved")) return "order_pending";
  if (active.includes("ordered")) return "ordered";
  if (active.includes("shipping")) return "shipping";
  return "received";
}

/**
 * Aligns the case stage with its linked purchase orders. No-op when the stage
 * already matches, so repeated transitions stay cheap and idempotent.
 */
export async function reconcileSourcingCaseStage(
  tx: Prisma.TransactionClient,
  caseId: string,
  now = new Date(),
): Promise<{ stage: string; changed: boolean } | null> {
  const linked = await tx.sourcingOrder.findMany({
    where: { caseId },
    include: { purchaseOrder: { select: { status: true } } },
  });
  const stage = deriveSourcingCaseStage(
    linked.map((link) => link.purchaseOrder?.status || ""),
  );
  if (!stage) return null;
  const current = await tx.sourcingCase.findUnique({
    where: { id: caseId },
    select: { stage: true },
  });
  if (!current) return null;
  if (current.stage === stage) return { stage, changed: false };
  await tx.sourcingCase.update({
    where: { id: caseId },
    data: { stage, version: { increment: 1 }, updatedAt: now },
  });
  return { stage, changed: true };
}
