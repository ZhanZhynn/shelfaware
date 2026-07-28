import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";

const schema = z.object({ workspaceId: z.string().min(1), supplierId: z.string().min(1), purchaseOrderId: z.string().min(1).optional(), qualityRating: z.number().int().min(1).max(5), timelinessRating: z.number().int().min(1).max(5), communicationRating: z.number().int().min(1).max(5), valueRating: z.number().int().min(1).max(5), notes: z.string().trim().max(2000).optional() });

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid supplier evaluation", details: parsed.error.flatten() }, { status: 400 });
    const data = parsed.data;
    await requireWorkspaceRole(user, data.workspaceId, ["admin"]);
    const supplier = await prisma.supplier.findFirst({ where: { id: data.supplierId, workspaceId: data.workspaceId }, select: { id: true } });
    if (!supplier) return NextResponse.json({ error: "Supplier not found in workspace" }, { status: 404 });
    if (data.purchaseOrderId) { const order = await prisma.purchaseOrder.findFirst({ where: { id: data.purchaseOrderId, workspaceId: data.workspaceId, supplierId: data.supplierId }, select: { id: true } }); if (!order) return NextResponse.json({ error: "Purchase order does not belong to this supplier" }, { status: 400 }); }
    const evaluation = await prisma.supplierEvaluation.create({ data: { ...data, createdById: user.id } });
    void invalidateAllServerCaches();
    return NextResponse.json(evaluation, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Evaluation request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
