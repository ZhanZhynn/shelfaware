import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { authorizePurchaseOrder } from "@/prisma/purchase-order";
import { getAdminDataScope } from "@/lib/admin/data-scope";
import { SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const scope = await getAdminDataScope(user);
    if (
      !(await authorizePurchaseOrder(
        user,
        id,
        ["admin", "sourcer"],
        scope.ownerIds,
      ))
    )
      return NextResponse.json(
        { error: "Purchase order not found or unauthorized" },
        { status: 404 },
      );
    const body = await request.json();
    const order = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { sourcingOrder: true },
      });
      if (!po) throw new SourcingAccessError("Purchase order not found", 404);
      if (po.status !== "approved")
        throw new SourcingAccessError(
          "Only supplier orders awaiting placement can be marked placed",
          409,
        );
      const now = new Date();
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "ordered",
          orderedAt: now,
          supplierOrderPlacedAt: now,
          supplierOrderPlacedById: user.id,
          supplierOrderReference: body.reference?.trim() || null,
          supplierOrderNotes: body.notes?.trim() || null,
          updatedBy: user.id,
        },
      });
      if (po.sourcingOrder) {
        const linked = await tx.sourcingOrder.findMany({
          where: { caseId: po.sourcingOrder.caseId },
          include: { purchaseOrder: { select: { status: true } } },
        });
        const allPlaced = linked.every((link) =>
          ["ordered", "shipping", "received"].includes(
            link.purchaseOrder?.status || "",
          ),
        );
        await tx.sourcingCase.update({
          where: { id: po.sourcingOrder.caseId },
          data: {
            stage: allPlaced ? "ordered" : "order_pending",
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        await tx.sourcingEvent.create({
          data: {
            workspaceId: po.sourcingOrder.workspaceId,
            caseId: po.sourcingOrder.caseId,
            actorId: user.id,
            type: "supplier_order_placed",
            payload: {
              purchaseOrderId: po.id,
              reference: body.reference?.trim() || null,
            },
          },
        });
      }
      return updated;
    });
    void invalidateAllServerCaches();
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to mark supplier order placed",
      },
      { status: error instanceof SourcingAccessError ? error.status : 500 },
    );
  }
}
