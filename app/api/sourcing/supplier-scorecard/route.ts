import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = new URL(request.url).searchParams.get("workspaceId"); if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    if (user.role === "sourcer") return NextResponse.json([]);
    const [orders, evaluations] = await Promise.all([
      prisma.purchaseOrder.findMany({ where: { workspaceId }, include: { supplier: { select: { id: true, name: true } }, items: { select: { quantity: true } }, receipts: { select: { finalizedAt: true, items: { select: { acceptedQuantity: true, damagedQuantity: true, shortageQuantity: true } } } } } }),
      prisma.supplierEvaluation.findMany({ where: { workspaceId } }),
    ]);
    const scores = new Map<string, { supplierId: string; supplierName: string; orders: number; ordered: number; accepted: number; defects: number; receivedOrders: number; leadTimeDays: number[]; onTimeOrders: number; evaluatedOrders: number; ratings: { quality: number; timeliness: number; communication: number; value: number }[] }>();
    for (const order of orders) { const row = scores.get(order.supplierId) || { supplierId: order.supplier.id, supplierName: order.supplier.name, orders: 0, ordered: 0, accepted: 0, defects: 0, receivedOrders: 0, leadTimeDays: [], onTimeOrders: 0, evaluatedOrders: 0, ratings: [] }; row.orders += 1; row.ordered += order.items.reduce((sum, item) => sum + item.quantity, 0); const receipts = order.receipts; const receiptItems = receipts.flatMap((receipt) => receipt.items); if (receiptItems.length) row.receivedOrders += 1; const completedAt = receipts.length ? receipts.reduce((latest, receipt) => receipt.finalizedAt > latest ? receipt.finalizedAt : latest, receipts[0]!.finalizedAt) : null; if (completedAt && order.orderedAt) row.leadTimeDays.push((completedAt.getTime() - order.orderedAt.getTime()) / 86_400_000); if (completedAt && order.estimatedDelivery) { row.evaluatedOrders += 1; if (completedAt <= order.estimatedDelivery) row.onTimeOrders += 1; } for (const item of receiptItems) { row.accepted += item.acceptedQuantity; row.defects += item.damagedQuantity + item.shortageQuantity; } scores.set(order.supplierId, row); }
    for (const evaluation of evaluations) { const row = scores.get(evaluation.supplierId); if (row) row.ratings.push({ quality: evaluation.qualityRating, timeliness: evaluation.timelinessRating, communication: evaluation.communicationRating, value: evaluation.valueRating }); }
    return NextResponse.json([...scores.values()].map((row) => { const average = (field: keyof (typeof row.ratings)[number]) => row.ratings.length ? row.ratings.reduce((sum, rating) => sum + rating[field], 0) / row.ratings.length : null; return { ...row, leadTimeDays: row.leadTimeDays.length ? row.leadTimeDays.reduce((sum, days) => sum + days, 0) / row.leadTimeDays.length : null, onTimeRate: row.evaluatedOrders ? row.onTimeOrders / row.evaluatedOrders : null, fillRate: row.ordered ? row.accepted / row.ordered : null, defectRate: row.accepted + row.defects ? row.defects / (row.accepted + row.defects) : null, receiptCoverage: row.orders ? row.receivedOrders / row.orders : 0, evaluationCount: row.ratings.length, averageRatings: { quality: average("quality"), timeliness: average("timeliness"), communication: average("communication"), value: average("value") } }; }).sort((a, b) => (a.defectRate ?? 0) - (b.defectRate ?? 0)));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Scorecard request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
