import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { requireGlobalAdmin, SourcingAccessError } from "@/lib/sourcing/auth";
import { z } from "zod";
import { invalidateAllServerCaches } from "@/lib/cache";

const bodySchema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).refine(({ sourceId, targetId }) => sourceId !== targetId, { message: "Source and target must differ" });

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await requireGlobalAdmin(session);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body", details: parsed.error.errors }, { status: 400 });
    const { sourceId, targetId } = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([tx.supplier.findUnique({ where: { id: sourceId } }), tx.supplier.findUnique({ where: { id: targetId } })]);
      if (!source || !target) throw new SourcingAccessError("Source or target supplier was not found", 404);
      if (source.workspaceId !== target.workspaceId) throw new SourcingAccessError("Suppliers must belong to the same workspace", 409);
      const [products, quotes, purchaseOrders, tickets, evaluations] = await Promise.all([
        tx.product.updateMany({ where: { supplierId: sourceId }, data: { supplierId: targetId, updatedBy: session.id, updatedAt: new Date() } }),
        tx.sourcingQuote.updateMany({ where: { supplierId: sourceId }, data: { supplierId: targetId } }),
        tx.purchaseOrder.updateMany({ where: { supplierId: sourceId }, data: { supplierId: targetId, updatedBy: session.id, updatedAt: new Date() } }),
        tx.supportTicket.updateMany({ where: { supplierId: sourceId }, data: { supplierId: targetId, updatedAt: new Date() } }),
        tx.supplierEvaluation.updateMany({ where: { supplierId: sourceId }, data: { supplierId: targetId } }),
      ]);
      await tx.supplier.update({ where: { id: sourceId }, data: { status: false, updatedBy: session.id, updatedAt: new Date() } });
      return { products: products.count, sourcingQuotes: quotes.count, purchaseOrders: purchaseOrders.count, supportTickets: tickets.count, evaluations: evaluations.count };
    });
    createAuditLog({ userId: session.id, action: "update", entityType: "supplier", entityId: sourceId, details: { operation: "merge", targetId, ...result } }).catch(() => {});
    void invalidateAllServerCaches();
    return NextResponse.json({ success: true, sourceId, targetId, migrated: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Supplier merge failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
