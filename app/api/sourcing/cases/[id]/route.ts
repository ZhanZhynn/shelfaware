import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { canEditQuote } from "@/lib/sourcing/workflow";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const item = await prisma.sourcingCase.findUnique({ where: { id: (await params).id }, include: { quotes: { orderBy: { revision: "desc" } }, orders: { include: { purchaseOrder: { include: { items: true } } } }, events: { orderBy: { createdAt: "desc" } } } });
    if (!item) return NextResponse.json({ error: "Sourcing case not found" }, { status: 404 });
    const access = await requireWorkspaceRole(user, item.workspaceId, ["admin", "sourcer"]);
    const canAdmin = access.globalAdmin || access.role === "admin";
    const assignee = item.assignedToId ? await prisma.user.findUnique({ where: { id: item.assignedToId }, select: { name: true, email: true } }) : null;
    return NextResponse.json({ ...item, assignee, capabilities: {
      canAssign: canAdmin,
      canEditQuote: canEditQuote(access.role, access.globalAdmin, item.assignedToId, user.id, item.stage),
      canDecide: canAdmin,
      canOrder: canAdmin && item.stage === "approved",
      canArchive: canAdmin && item.stage !== "ordered",
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
