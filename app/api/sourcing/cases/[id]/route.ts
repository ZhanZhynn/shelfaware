import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { canEditQuote } from "@/lib/sourcing/workflow";
import { getCurrentExchangeRate } from "@/lib/exchange-rates/service";
import { sourcingPurchaseOrderEstimate } from "@/lib/sourcing/purchase-order-currency";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const item = await prisma.sourcingCase.findUnique({ where: { id: (await params).id }, include: { quotes: { orderBy: { revision: "desc" } }, orders: { include: { purchaseOrder: { include: { items: true, supplier: { select: { id: true, name: true } } } } } }, events: { orderBy: { createdAt: "desc" } } } });
    if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    const access = await requireWorkspaceRole(user, item.workspaceId, ["admin", "sourcer"]);
    const canAdmin = access.globalAdmin || access.role === "admin";
    const assignee = item.assignedToId ? await prisma.user.findUnique({ where: { id: item.assignedToId }, select: { name: true, email: true } }) : null;
    const currentCnyMyrRate = await getCurrentExchangeRate("CNY", "MYR");
    const quotesById = new Map(item.quotes.map((quote) => [quote.id, quote]));
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
    return NextResponse.json({ ...item, orders, assignee, capabilities: {
      canAssign: canAdmin,
      canEditQuote: canEditQuote(access.role, access.globalAdmin, item.assignedToId, user.id, item.stage),
      canDecide: canAdmin,
      canOrder: canAdmin && item.stage === "approved",
       canArchive: canAdmin && !["ordered", "shipped", "received"].includes(item.stage),
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
