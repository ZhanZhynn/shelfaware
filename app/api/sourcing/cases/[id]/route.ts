import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { canEditQuote } from "@/lib/sourcing/workflow";
import { getCurrentExchangeRate } from "@/lib/exchange-rates/service";
import { sourcingPurchaseOrderEstimate } from "@/lib/sourcing/purchase-order-currency";
import { updateSourcingNextAction } from "@/lib/sourcing/commands";
import { sourcingNextActionSchema } from "@/lib/validations/sourcing";
import { invalidateAllServerCaches } from "@/lib/cache";
import { ZodError } from "zod";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const item = await prisma.sourcingCase.findUnique({ where: { id: (await params).id }, include: { quotes: { orderBy: { revision: "desc" } }, orders: { include: { purchaseOrder: { include: { items: true, supplier: { select: { id: true, name: true } } } } } }, events: { orderBy: { createdAt: "desc" } }, comments: { include: { author: { select: { id: true, name: true, email: true, image: true } } }, orderBy: { createdAt: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } } });
    if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    const access = await requireWorkspaceRole(user, item.workspaceId, ["admin", "sourcer"]);
    const canAdmin = access.globalAdmin || access.role === "admin";
    const assignee = item.assignedToId ? await prisma.user.findUnique({ where: { id: item.assignedToId }, select: { name: true, email: true } }) : null;
    const currentCnyMyrRate = await getCurrentExchangeRate("CNY", "MYR");
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
    return NextResponse.json({ ...item, quotes, orders, assignee, attachments: item.attachments.map((attachment) => ({ ...attachment, canDelete: attachment.uploadedById === user.id })), capabilities: {
      canAssign: canAdmin,
      canEditQuote: canEditQuote(access.role, access.globalAdmin, item.assignedToId, user.id, item.stage),
      canDecide: canAdmin,
       canOrder: canAdmin && item.stage === "approved",
        canArchive: canAdmin && !["ordered", "shipped", "received"].includes(item.stage),
       canUpdateNextAction: canAdmin || item.assignedToId === user.id,
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = sourcingNextActionSchema.parse(await request.json());
    const item = await updateSourcingNextAction(user, (await params).id, input);
    void invalidateAllServerCaches();
    return NextResponse.json(item);
  } catch (error) {
    const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status });
  }
}
