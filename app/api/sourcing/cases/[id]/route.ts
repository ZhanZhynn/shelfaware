import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import {
  requireAssignedSourcer,
  requireWorkspaceRole,
  SourcingAccessError,
} from "@/lib/sourcing/auth";
import { canEditQuote } from "@/lib/sourcing/workflow";
import { getCurrentExchangeRate } from "@/lib/exchange-rates/service";
import { sourcingPurchaseOrderEstimate } from "@/lib/sourcing/purchase-order-currency";
import { updateSourcingNextAction } from "@/lib/sourcing/commands";
import { sourcingNextActionSchema, sourcingRequestUpdateSchema } from "@/lib/validations/sourcing";
import { invalidateAllServerCaches } from "@/lib/cache";
import { deleteSourcingAttachmentFromImageKit } from "@/lib/imagekit";
import { deleteStoredSourcingAttachment } from "@/lib/sourcing/attachment-storage";
import { ZodError } from "zod";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const item = await prisma.sourcingCase.findUnique({ where: { id: (await params).id }, include: { variants: { orderBy: { position: "asc" }, include: { selection: true } }, quotes: { orderBy: { revision: "desc" }, include: { lines: { orderBy: { createdAt: "asc" } } } }, orders: { include: { purchaseOrder: { include: { items: true, supplier: { select: { id: true, name: true } } } } } }, events: { orderBy: { createdAt: "desc" } }, comments: { include: { author: { select: { id: true, name: true, email: true, image: true } } }, orderBy: { createdAt: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } } });
    if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    const access = await requireWorkspaceRole(user, item.workspaceId, ["admin", "sourcer"]);
    requireAssignedSourcer(user, item.assignedToId);
    const canAdmin = access.globalAdmin || access.role === "admin";
    const assignee = item.assignedToId ? await prisma.user.findUnique({ where: { id: item.assignedToId }, select: { name: true, email: true } }) : null;
    const [currentCnyMyrRate, workspace] = await Promise.all([getCurrentExchangeRate("CNY", "MYR"), prisma.workspace.findUnique({ where: { id: item.workspaceId }, select: { sourcingCostConfig: true } })]);
    // Phase 8 groups new offers explicitly. Older cases had one quote stream,
    // so expose their unbackfilled revisions as one group until the script runs.
    const legacyGroupId = item.quotes.find((quote) => quote.quoteGroupId === quote.id)?.quoteGroupId
      || item.quotes.find((quote) => !quote.quoteGroupId)?.id;
    const quotes = item.quotes.map((quote) => ({
      ...quote,
      quoteGroupId: quote.quoteGroupId || legacyGroupId || quote.id,
    }));
    const quotesById = new Map(quotes.map((quote) => [quote.id, quote]));
    const orders = item.orders.map((order) => {
      if (!order.purchaseOrder) return order;
      const quote = quotesById.get(order.quoteId);
      const purchaseOrder = {
        ...order.purchaseOrder,
        currency: order.purchaseOrder.currency || quote?.currency || "MYR",
      };
      return {
        ...order,
        purchaseOrder: {
          ...purchaseOrder,
          ...sourcingPurchaseOrderEstimate(purchaseOrder, currentCnyMyrRate),
        },
      };
    });
    return NextResponse.json({ ...item, quotes, orders, assignee, costConfig: workspace?.sourcingCostConfig ?? null, attachments: item.attachments.map((attachment) => ({ ...attachment, canDelete: attachment.uploadedById === user.id })), capabilities: {
      canAssign: canAdmin,
      canEditQuote: canEditQuote(access.role, access.globalAdmin, item.assignedToId, user.id, item.stage),
      canDecide: canAdmin,
       canOrder: canAdmin && item.stage === "approved",
        canArchive: canAdmin && !["ordered", "shipping", "received"].includes(item.stage),
       canUpdateNextAction: canAdmin || item.assignedToId === user.id,
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = (await params).id;
    const body = await request.json();
    if (body.request) {
      const input = sourcingRequestUpdateSchema.parse(body.request);
      const item = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, workspaceId: true, stage: true, version: true } });
      if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
      const access = await requireWorkspaceRole(user, item.workspaceId, ["admin"]);
      if (!access.globalAdmin && access.role !== "admin") throw new SourcingAccessError("Only workspace admins can edit requests", 403);
      if (item.stage !== "draft") return NextResponse.json({ error: "Only draft requests can be edited" }, { status: 409 });
      if (item.version !== input.version) return NextResponse.json({ error: "This request has changed. Refresh and try again." }, { status: 409 });
      const updated = await prisma.sourcingCase.update({
        where: { id },
        data: {
          title: input.title.trim(), description: input.description?.trim() || null,
          size: input.size?.trim() || null, material: input.material?.trim() || null,
          variant: input.variant?.trim() || null, specifications: input.specifications?.trim() || null,
          referenceUrl: input.referenceUrl?.trim() || null, notes: input.notes?.trim() || null,
          requestedQuantity: input.requestedQuantity ?? null, targetUnitPriceMyr: input.targetUnitPriceMyr ?? null,
          version: { increment: 1 }, updatedAt: new Date(),
        },
      });
      void invalidateAllServerCaches();
      return NextResponse.json(updated);
    }
    const input = sourcingNextActionSchema.parse(body);
    const item = await updateSourcingNextAction(user, id, input);
    void invalidateAllServerCaches();
    return NextResponse.json(item);
  } catch (error) {
    const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const item = await prisma.sourcingCase.findUnique({
      where: { id: (await params).id },
      include: { attachments: { select: { fileId: true, storage: true } }, orders: { select: { id: true } } },
    });
    if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    const access = await requireWorkspaceRole(user, item.workspaceId, ["admin"]);
    if (!access.globalAdmin && access.role !== "admin") throw new SourcingAccessError("Only workspace admins can delete cases", 403);
    if (!["draft", "cancelled"].includes(item.stage)) return NextResponse.json({ error: "Only draft or cancelled cases can be deleted" }, { status: 409 });
    if (item.orders.length) return NextResponse.json({ error: "Cases with purchase orders cannot be deleted" }, { status: 409 });
    await prisma.sourcingCase.delete({ where: { id: item.id } });
    await Promise.all(item.attachments.map((attachment) =>
      (attachment.storage === "mongodb"
        ? deleteStoredSourcingAttachment(attachment.fileId)
        : deleteSourcingAttachmentFromImageKit(attachment.fileId)
      ).catch(() => {}),
    ));
    void invalidateAllServerCaches();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request deletion failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
