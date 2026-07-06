import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { receiveBodySchema } from "@/lib/validations/receiving";
import { prisma } from "@/prisma/client";
import { createStockMovement } from "@/prisma/stock-movement";
import { invalidateAllServerCaches } from "@/lib/cache";
import { logger } from "@/lib/logger";
import type { ReceiveResult, ReceivedItemResult } from "@/types/receiving";

export async function POST(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = receiveBodySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { warehouseId, poId, items, notes } = validation.data;
    const userId = session.id;

    // Validate warehouse exists and belongs to user
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, userId },
      select: { id: true },
    });
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    // If PO-linked, validate the PO
    let po: { id: string; status: string; items: { id: string; productId: string; quantity: number; quantityReceived: number }[] } | null = null;
    if (poId) {
      po = await prisma.purchaseOrder.findFirst({
        where: { id: poId, userId },
        select: {
          id: true,
          status: true,
          items: { select: { id: true, productId: true, quantity: true, quantityReceived: true } },
        },
      });
      if (!po) {
        return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
      }
      if (!["approved", "ordered"].includes(po.status)) {
        return NextResponse.json(
          { error: `PO must be approved or ordered to receive (current: ${po.status})` },
          { status: 400 },
        );
      }
    }

    const results: ReceivedItemResult[] = [];

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // Verify product exists and belongs to user
        const product = await tx.product.findFirst({
          where: { id: item.productId, userId },
          select: { id: true, sku: true, quantity: true },
        });
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }

        const qty = BigInt(item.quantity);

        // If PO-linked, validate the PO item and increment quantityReceived
        let poItemStatus: ReceivedItemResult["poItemStatus"] | undefined;
        if (poId && item.poItemId && po) {
          const poItem = po.items.find((pi) => pi.id === item.poItemId);
          if (!poItem) {
            throw new Error(`PO item ${item.poItemId} not found in purchase order`);
          }
          if (poItem.productId !== item.productId) {
            throw new Error(`Product mismatch: scanned product does not match PO item`);
          }

          await tx.purchaseOrderItem.update({
            where: { id: item.poItemId },
            data: { quantityReceived: { increment: item.quantity } },
          });

          poItemStatus = {
            quantityOrdered: poItem.quantity,
            quantityReceived: poItem.quantityReceived + item.quantity,
            fullyReceived: poItem.quantityReceived + item.quantity >= poItem.quantity,
          };
        }

        // Upsert stock allocation (increment if exists, create if not)
        await tx.stockAllocation.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          update: { quantity: { increment: qty }, updatedAt: new Date() },
          create: {
            productId: item.productId,
            warehouseId,
            quantity: qty,
            userId,
          },
        });

        // Increment global product quantity
        const updatedProduct = await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { increment: qty } },
          select: { quantity: true },
        });

        // Create stock movement record for audit
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId,
            quantity: qty,
            type: "in",
            sourceType: poId ? "purchase_order" : "ad_hoc",
            sourceId: poId ?? null,
            poItemId: item.poItemId ?? null,
            receivedById: userId,
            notes: notes ?? item.notes ?? null,
          },
        });

        results.push({
          productId: item.productId,
          sku: product.sku ?? item.sku,
          quantity: item.quantity,
          newStockLevel: Number(updatedProduct.quantity),
          poItemStatus,
        });
      }

      // If PO-linked, check if all items are fully received → mark PO as received
      if (poId && po) {
        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: poId },
          select: { quantity: true, quantityReceived: true },
        });
        const allReceived = updatedItems.every((i) => i.quantityReceived >= i.quantity);
        if (allReceived) {
          await tx.purchaseOrder.update({
            where: { id: poId },
            data: { status: "received", receivedAt: new Date(), updatedBy: userId },
          });
        }
      }
    });

    // Invalidate caches (fire-and-forget)
    invalidateAllServerCaches().catch((e) =>
      logger.error("[Receiving] Cache invalidation failed:", e),
    );

    let poStatus: string | undefined;
    if (poId && po) {
      const updatedPo = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { status: true },
      });
      poStatus = updatedPo?.status;
    }

    const result: ReceiveResult = { received: results, poStatus };
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logger.error("[Receiving] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process receiving" },
      { status: 500 },
    );
  }
}
