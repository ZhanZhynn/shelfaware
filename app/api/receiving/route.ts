import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { receiveBodySchema } from "@/lib/validations/receiving";
import { prisma } from "@/prisma/client";
import { invalidateAllServerCaches } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import type { ReceiveResult, ReceivedItemResult } from "@/types/receiving";

export async function POST(request: NextRequest) {
  const limited = await withRateLimit(request, defaultRateLimits.strict);
  if (limited) return limited;
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const validation = receiveBodySchema.safeParse(await request.json());
    if (!validation.success) return NextResponse.json({ error: "Invalid request", details: validation.error.flatten() }, { status: 400 });
    const { warehouseId, poId, items, notes } = validation.data;
    if (!poId && user.role !== "admin") throw new SourcingAccessError("Only global admins may create ad-hoc receipts");

    // MongoDB reports concurrent writes as transaction conflicts. Retrying the
    // complete unit lets the second receipt observe the first receipt's lines.
    const receive = async () => prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, userId: true, workspaceId: true } });
      if (!warehouse) throw new SourcingAccessError("Warehouse not found", 404);
      const po = poId ? await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true, sourcingOrder: true } }) : null;
      if (poId && !po) throw new SourcingAccessError("Purchase order not found", 404);
      if (po && !["approved", "ordered"].includes(po.status)) throw new SourcingAccessError(`PO must be approved or ordered to receive (current: ${po.status})`, 409);
      if (po?.workspaceId) {
        await requireWorkspaceRole(user, po.workspaceId, ["admin", "warehouse"]);
        if (warehouse.workspaceId !== po.workspaceId) throw new SourcingAccessError("Warehouse must belong to the purchase order workspace", 400);
      } else {
        if (warehouse.workspaceId || (po && po.userId !== warehouse.userId)) {
          throw new SourcingAccessError("Legacy purchase order and warehouse must have the same owner", 400);
        }
        if (warehouse.userId !== user.id && user.role !== "admin") throw new SourcingAccessError("Warehouse is not available to this user");
      }
      if (po && items.some((item) => !item.poItemId)) throw new SourcingAccessError("Each PO receipt line requires a purchase-order item", 400);
      if (po) {
        // Touch the parent document so concurrent partial receipts conflict even
        // when they update different PO lines, forcing one transaction to retry.
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { updatedAt: new Date(), updatedBy: user.id } });
      }
      const results: ReceivedItemResult[] = [];
      const receiptItems: { purchaseOrderItemId: string; productId: string; acceptedQuantity: number; damagedQuantity: number; shortageQuantity: number; notes?: string }[] = [];
      const pendingByPoItem = new Map<string, number>();
      for (const item of items) {
        const accepted = item.acceptedQuantity ?? item.quantity ?? 0;
        const total = accepted + item.damagedQuantity + item.shortageQuantity;
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, sku: true, quantity: true, userId: true, workspaceId: true } });
        if (!product || (po?.workspaceId && product.workspaceId !== po.workspaceId)) throw new SourcingAccessError(`Product ${item.productId} not found in this workspace`, 404);
        if (!po?.workspaceId && (product.workspaceId || product.userId !== warehouse.userId || (po && product.userId !== po.userId))) {
          throw new SourcingAccessError(`Product ${item.productId} is not in the legacy purchase order scope`, 400);
        }
        let poItemStatus: ReceivedItemResult["poItemStatus"];
        if (po) {
          const poItem = po.items.find((line) => line.id === item.poItemId);
          if (!poItem || poItem.productId !== item.productId) throw new SourcingAccessError("Receipt line does not match a PO item", 400);
          const newTotal = (pendingByPoItem.get(poItem.id) ?? 0) + total;
          if (poItem.quantityReceived + newTotal > poItem.quantity) throw new SourcingAccessError(`Receipt exceeds ordered quantity for ${poItem.sku ?? poItem.productName}`, 409);
          pendingByPoItem.set(poItem.id, newTotal);
          poItemStatus = { quantityOrdered: poItem.quantity, quantityReceived: poItem.quantityReceived + newTotal, fullyReceived: poItem.quantityReceived + newTotal === poItem.quantity };
          receiptItems.push({ purchaseOrderItemId: poItem.id, productId: item.productId, acceptedQuantity: accepted, damagedQuantity: item.damagedQuantity, shortageQuantity: item.shortageQuantity, notes: item.notes });
        }
        let stock = product.quantity;
        if (accepted > 0) {
          const acceptedBigInt = BigInt(accepted);
          await tx.stockAllocation.upsert({ where: { productId_warehouseId: { productId: product.id, warehouseId } }, update: { quantity: { increment: acceptedBigInt }, updatedAt: new Date() }, create: { productId: product.id, warehouseId, quantity: acceptedBigInt, userId: user.id, workspaceId: po?.workspaceId } });
          const updated = await tx.product.update({ where: { id: product.id }, data: { quantity: { increment: acceptedBigInt } }, select: { quantity: true } });
          stock = updated.quantity;
          await tx.stockMovement.create({ data: { productId: product.id, warehouseId, quantity: acceptedBigInt, type: "in", sourceType: po ? "purchase_order" : "ad_hoc", sourceId: po?.id, poItemId: item.poItemId, receivedById: user.id, workspaceId: po?.workspaceId, notes: notes ?? item.notes } });
        }
        results.push({ productId: product.id, sku: product.sku, quantity: accepted, newStockLevel: Number(stock), poItemStatus });
      }
      if (po) {
        for (const [poItemId, quantity] of pendingByPoItem) await tx.purchaseOrderItem.update({ where: { id: poItemId }, data: { quantityReceived: { increment: quantity } } });
        const updatedLines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, select: { quantity: true, quantityReceived: true } });
        const complete = updatedLines.every((line) => line.quantityReceived >= line.quantity);
        if (complete) {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "received", receivedAt: new Date(), updatedBy: user.id } });
          if (po.sourcingOrder?.caseId) {
            await tx.sourcingCase.update({ where: { id: po.sourcingOrder.caseId }, data: { stage: "received", version: { increment: 1 }, updatedAt: new Date() } });
            await tx.sourcingEvent.create({ data: { caseId: po.sourcingOrder.caseId, workspaceId: po.workspaceId!, actorId: user.id, type: "received", payload: { purchaseOrderId: po.id, poNumber: po.poNumber } } });
          }
        }
        if (po.workspaceId) {
          await tx.purchaseReceipt.create({ data: { workspaceId: po.workspaceId, purchaseOrderId: po.id, sourcingOrderId: po.sourcingOrder?.id, sourcingCaseId: po.sourcingOrder?.caseId, warehouseId, receivedById: user.id, notes, items: { create: receiptItems } } });
        }
      }
      const status = po ? (await tx.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } }))?.status : undefined;
      return { received: results, poStatus: status } satisfies ReceiveResult;
    });
    let result: ReceiveResult | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await receive();
        break;
      } catch (error) {
        if (attempt === 2 || !(error instanceof Error) || !/write conflict|transaction.*conflict|P2034/i.test(error.message)) throw error;
      }
    }
    if (!result) throw new Error("Receiving transaction did not complete");
    void invalidateAllServerCaches().catch((error) => logger.error("[Receiving] Cache invalidation failed", error));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logger.error("[Receiving] Error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to process receiving" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
