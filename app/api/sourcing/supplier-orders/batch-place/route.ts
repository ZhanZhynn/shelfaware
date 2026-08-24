import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const submittedIds: unknown[] = Array.isArray(body.purchaseOrderIds)
      ? body.purchaseOrderIds
      : [];
    const ids = Array.from(
      new Set<string>(
        submittedIds.filter((id): id is string => typeof id === "string"),
      ),
    );
    if (!ids.length)
      return NextResponse.json({ error: "Select at least one purchase order" }, { status: 400 });
    const placed = await prisma.$transaction(async (tx) => {
      const orders = await tx.sourcingOrder.findMany({
        where: { purchaseOrderId: { in: ids } },
        include: { sourcingCase: true, purchaseOrder: true },
      });
      if (orders.length !== ids.length) throw new SourcingAccessError("Purchase order not found", 404);
      const firstOrder = orders[0];
      if (!firstOrder) throw new SourcingAccessError("Purchase order not found", 404);
      const workspaceId = firstOrder.workspaceId;
      await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
      if (orders.some((order) => order.workspaceId !== workspaceId))
        throw new SourcingAccessError("Purchase orders must belong to one workspace", 400);
      if (user.role === "sourcer" && orders.some((order) => order.sourcingCase.assignedToId !== user.id))
        throw new SourcingAccessError("Purchase order not assigned to you", 403);
      if (orders.some((order) => order.purchaseOrder?.status !== "approved"))
        throw new SourcingAccessError("Only supplier orders awaiting placement can be marked placed", 409);
      const supplierIds = new Set(orders.map((order) => order.purchaseOrder?.supplierId));
      if (supplierIds.size !== 1)
        throw new SourcingAccessError("Batch placement requires one supplier", 400);
      const now = new Date();
      await tx.purchaseOrder.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "ordered", orderedAt: now, supplierOrderPlacedAt: now,
          supplierOrderPlacedById: user.id, supplierOrderReference: body.reference?.trim() || null,
          supplierOrderNotes: body.notes?.trim() || null, updatedBy: user.id,
        },
      });
      const caseIds = [...new Set(orders.map((order) => order.caseId))];
      for (const caseId of caseIds) {
        const linked = await tx.sourcingOrder.findMany({ where: { caseId }, include: { purchaseOrder: { select: { status: true } } } });
        const allPlaced = linked.every((link) => ["ordered", "shipping", "received"].includes(link.purchaseOrder?.status || ""));
        await tx.sourcingCase.update({ where: { id: caseId }, data: { stage: allPlaced ? "ordered" : "order_pending", version: { increment: 1 }, updatedAt: now } });
      }
      await tx.sourcingEvent.createMany({ data: orders.map((order) => ({ workspaceId, caseId: order.caseId, actorId: user.id, type: "supplier_order_placed", payload: { purchaseOrderId: order.purchaseOrderId, reference: body.reference?.trim() || null } })) });
      return ids;
    });
    void invalidateAllServerCaches();
    return NextResponse.json({ purchaseOrderIds: placed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark supplier orders placed" },
      { status: error instanceof SourcingAccessError ? error.status : 500 },
    );
  }
}
