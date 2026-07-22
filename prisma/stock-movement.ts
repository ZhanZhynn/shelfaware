import prisma from "@/prisma/client";
import type { StockMovementRecord } from "@/types/receiving";

export async function createStockMovement(data: {
  productId: string;
  warehouseId: string;
  quantity: bigint;
  type: string;
  sourceType?: string;
  sourceId?: string;
  poItemId?: string;
  receivedById: string;
  notes?: string;
}) {
  return prisma.stockMovement.create({ data });
}

export async function getStockMovementsForUser(
  userId: string,
  filters?: { productId?: string; warehouseId?: string; sourceType?: string; limit?: number },
  workspaceIds?: string[],
  globalAdmin = false,
): Promise<StockMovementRecord[]> {
  const where: Record<string, unknown> = globalAdmin ? {} : workspaceIds ? { OR: [{ receivedById: userId }, { workspaceId: { in: workspaceIds } }] } : { receivedById: userId };
  if (filters?.productId) where.productId = filters.productId;
  if (filters?.warehouseId) where.warehouseId = filters.warehouseId;
  if (filters?.sourceType) where.sourceType = filters.sourceType;

  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: filters?.limit ?? 50,
    include: {
      product: { select: { name: true } },
      warehouse: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  return movements.map((m) => ({
    id: m.id,
    productId: m.productId,
    productName: m.product?.name,
    warehouseId: m.warehouseId,
    warehouseName: m.warehouse?.name,
    quantity: Number(m.quantity),
    type: m.type,
    sourceType: m.sourceType ?? undefined,
    sourceId: m.sourceId ?? undefined,
    poItemId: m.poItemId ?? undefined,
    receivedById: m.receivedById,
    receivedByName: m.user?.name,
    receivedAt: m.receivedAt.toISOString(),
    notes: m.notes ?? undefined,
  }));
}

export async function getMovementsByProduct(productId: string) {
  return prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { receivedAt: "desc" },
  });
}

export async function getMovementsByWarehouse(warehouseId: string) {
  return prisma.stockMovement.findMany({
    where: { warehouseId },
    orderBy: { receivedAt: "desc" },
  });
}

export async function getMovementsByPo(poId: string) {
  return prisma.stockMovement.findMany({
    where: { sourceType: "purchase_order", sourceId: poId },
    orderBy: { receivedAt: "desc" },
  });
}
