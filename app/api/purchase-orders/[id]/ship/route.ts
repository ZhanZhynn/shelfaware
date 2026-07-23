import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { Prisma } from "@prisma/client";
import { authorizePurchaseOrder } from "@/prisma/purchase-order";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";
import { completeSourcingSla } from "@/lib/sourcing/sla";
import { invalidateAllServerCaches } from "@/lib/cache";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!await authorizePurchaseOrder(session, id, ["admin", "sourcer"])) {
      return NextResponse.json({ error: "Purchase order not found or unauthorized" }, { status: 404 });
    }

    const body = await request.json();
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }
    if (existing.status !== "ordered") {
      return NextResponse.json({ error: "Only ordered purchase orders can be marked as shipped" }, { status: 409 });
    }

    const order = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "shipped",
        shippedAt: new Date(),
        trackingNumber: body.trackingNumber?.trim() || null,
        trackingCarrier: body.trackingCarrier?.trim() || null,
        trackingUrl: body.trackingUrl?.trim() || null,
        estimatedDelivery: body.estimatedDelivery ? new Date(body.estimatedDelivery) : null,
        shippingNotes: body.shippingNotes?.trim() || null,
        notes: body.notes?.trim() || existing.notes,
        updatedBy: session.id,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });

    try {
      const sourcingOrder = await prisma.sourcingOrder.findUnique({
        where: { purchaseOrderId: id },
        select: { caseId: true, workspaceId: true },
      });
      if (sourcingOrder) {
        await prisma.$transaction(async (tx) => {
          const now = new Date();
          await completeSourcingSla(tx, sourcingOrder.caseId, "shipment", now);
          await tx.sourcingCase.update({
            where: { id: sourcingOrder.caseId },
            data: { stage: "shipped", slaDueAt: null, slaRule: null, version: { increment: 1 }, updatedAt: now },
          });
        });
        await prisma.sourcingEvent.create({
          data: {
            caseId: sourcingOrder.caseId,
            workspaceId: sourcingOrder.workspaceId,
            actorId: session.id,
            type: "shipped",
            payload: json({
              purchaseOrderId: id,
              poNumber: order.poNumber,
              trackingCarrier: order.trackingCarrier,
              trackingNumber: order.trackingNumber,
            }),
          },
        });
      }
    } catch (eventError) {
      logger.error("[Ship] Failed to create sourcing event", eventError);
    }

    void invalidateAllServerCaches();
    return NextResponse.json({
      ...order,
      supplierName: order.supplier.name,
      items: order.items.map((item) => ({
        ...item,
        unitCost: Number(item.unitCost),
        subtotal: Number(item.subtotal),
      })),
      totalAmount: Number(order.totalAmount),
    });
  } catch (error) {
    logger.error("Error marking purchase order as shipped:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to ship purchase order" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!await authorizePurchaseOrder(session, id, ["admin", "sourcer"])) {
      return NextResponse.json({ error: "Purchase order not found or unauthorized" }, { status: 404 });
    }

    const body = await request.json();
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }
    if (existing.status !== "shipped") {
      return NextResponse.json({ error: "Tracking info can only be updated on shipped purchase orders" }, { status: 409 });
    }

    const order = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        trackingNumber: body.trackingNumber?.trim() || null,
        trackingCarrier: body.trackingCarrier?.trim() || null,
        trackingUrl: body.trackingUrl?.trim() || null,
        estimatedDelivery: body.estimatedDelivery ? new Date(body.estimatedDelivery) : null,
        shippingNotes: body.shippingNotes?.trim() || null,
        notes: body.notes?.trim() || existing.notes,
        updatedBy: session.id,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });

    try {
      const sourcingOrder = await prisma.sourcingOrder.findUnique({
        where: { purchaseOrderId: id },
        select: { caseId: true, workspaceId: true },
      });
      if (sourcingOrder) {
        await prisma.sourcingEvent.create({
          data: {
            caseId: sourcingOrder.caseId,
            workspaceId: sourcingOrder.workspaceId,
            actorId: session.id,
            type: "shipping_updated",
            payload: json({
              purchaseOrderId: id,
              poNumber: order.poNumber,
              trackingCarrier: order.trackingCarrier,
              trackingNumber: order.trackingNumber,
            }),
          },
        });
      }
    } catch (eventError) {
      logger.error("[Ship] Failed to create sourcing event", eventError);
    }

    void invalidateAllServerCaches();
    return NextResponse.json({
      ...order,
      supplierName: order.supplier.name,
      items: order.items.map((item) => ({
        ...item,
        unitCost: Number(item.unitCost),
        subtotal: Number(item.subtotal),
      })),
      totalAmount: Number(order.totalAmount),
    });
  } catch (error) {
    logger.error("Error updating shipping info:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update shipping info" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!await authorizePurchaseOrder(session, id, ["admin", "sourcer"])) {
      return NextResponse.json({ error: "Purchase order not found or unauthorized" }, { status: 404 });
    }

    const body = await request.json();
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }
    if (!["ordered", "shipped"].includes(existing.status)) {
      return NextResponse.json({ error: "Notes can only be updated on ordered or shipped purchase orders" }, { status: 409 });
    }

    const order = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        notes: body.notes?.trim() || null,
        updatedBy: session.id,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });

    try {
      const sourcingOrder = await prisma.sourcingOrder.findUnique({
        where: { purchaseOrderId: id },
        select: { caseId: true, workspaceId: true },
      });
      if (sourcingOrder) {
        await prisma.sourcingEvent.create({
          data: {
            caseId: sourcingOrder.caseId,
            workspaceId: sourcingOrder.workspaceId,
            actorId: session.id,
            type: "po_notes_updated",
            payload: json({
              purchaseOrderId: id,
              poNumber: order.poNumber,
            }),
          },
        });
      }
    } catch (eventError) {
      logger.error("[Ship] Failed to create sourcing event", eventError);
    }

    void invalidateAllServerCaches();
    return NextResponse.json({
      ...order,
      supplierName: order.supplier.name,
      items: order.items.map((item) => ({
        ...item,
        unitCost: Number(item.unitCost),
        subtotal: Number(item.subtotal),
      })),
      totalAmount: Number(order.totalAmount),
    });
  } catch (error) {
    logger.error("Error updating purchase order notes:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update notes" },
      { status: 500 },
    );
  }
}
