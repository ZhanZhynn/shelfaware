import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import { requireWorkspaceRole } from "@/lib/sourcing/auth";

type PurchaseOrderActor = { id: string; role: string | null };

export async function authorizePurchaseOrder(
  actor: PurchaseOrderActor,
  id: string,
  allowedWorkspaceRoles: readonly ("admin" | "warehouse")[],
) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, userId: true, workspaceId: true } });
  if (!order) return null;
  if (order.workspaceId) {
    await requireWorkspaceRole(actor, order.workspaceId, allowedWorkspaceRoles);
    return order;
  }
  return order.userId === actor.id || actor.role === "admin" ? order : null;
}

export async function getPurchaseOrdersForUser(
  userId: string,
  filters?: { status?: string; supplierId?: string; workspaceIds?: string[]; globalAdmin?: boolean },
) {
  const where: Record<string, unknown> = filters?.globalAdmin ? {} : filters?.workspaceIds ? { OR: [{ userId }, { workspaceId: { in: filters.workspaceIds } }] } : { userId };
  if (filters?.status) where.status = filters.status;
  if (filters?.supplierId) where.supplierId = filters.supplierId;

  const orders = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.map((po) => ({
    ...po,
    supplierName: po.supplier.name,
    items: po.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      subtotal: Number(item.subtotal),
    })),
    totalAmount: Number(po.totalAmount),
  }));
}

export async function getPurchaseOrderById(id: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  if (!order) return null;

  return {
    ...order,
    supplierName: order.supplier.name,
    items: order.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      subtotal: Number(item.subtotal),
    })),
    totalAmount: Number(order.totalAmount),
  };
}

export async function createPurchaseOrder(
  userId: string,
  data: {
    supplierId: string;
    notes?: string;
    items: { productId: string; productName: string; sku?: string; quantity: number; unitCost: number }[];
    workspaceId?: string;
  },
) {
  const poNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const totalAmount = data.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  if (data.workspaceId) {
    const [supplier, products] = await Promise.all([
      prisma.supplier.findFirst({ where: { id: data.supplierId, workspaceId: data.workspaceId } }),
      prisma.product.findMany({ where: { id: { in: data.items.map((item) => item.productId) }, workspaceId: data.workspaceId }, select: { id: true } }),
    ]);
    if (!supplier || products.length !== new Set(data.items.map((item) => item.productId)).size) throw new Error("Supplier and products must belong to the selected workspace");
  }
  const order = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: data.supplierId,
      userId,
      workspaceId: data.workspaceId,
      status: "draft",
      totalAmount,
      notes: data.notes,
      createdBy: userId,
      items: {
        create: data.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitCost: item.unitCost,
          subtotal: item.quantity * item.unitCost,
        })),
      },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  return {
    ...order,
    supplierName: order.supplier.name,
    items: order.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      subtotal: Number(item.subtotal),
    })),
    totalAmount: Number(order.totalAmount),
  };
}

export async function updatePurchaseOrder(
  userId: string,
  id: string,
  data: { notes?: string; items?: { productId: string; productName: string; sku?: string; quantity: number; unitCost: number }[] },
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.status !== "draft") return null;

  let totalAmount = Number(existing.totalAmount);
  if (data.items) {
    const productWhere = existing.workspaceId
      ? { id: { in: data.items.map((item) => item.productId) }, workspaceId: existing.workspaceId }
      : { id: { in: data.items.map((item) => item.productId) }, userId: existing.userId, workspaceId: null };
    const products = await prisma.product.findMany({ where: productWhere, select: { id: true } });
    if (products.length !== new Set(data.items.map((item) => item.productId)).size) {
      throw new Error("Products must belong to the purchase order scope");
    }
    totalAmount = data.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      notes: data.notes,
      totalAmount,
      updatedBy: userId,
      ...(data.items && {
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitCost: item.unitCost,
            subtotal: item.quantity * item.unitCost,
          })),
        },
      }),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  return {
    ...order,
    supplierName: order.supplier.name,
    items: order.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      subtotal: Number(item.subtotal),
    })),
    totalAmount: Number(order.totalAmount),
  };
}

export async function deletePurchaseOrder(userId: string, id: string) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return false;
  if (!["draft", "pending_approval"].includes(existing.status)) return false;

  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
  await prisma.purchaseOrder.delete({ where: { id } });
  return true;
}

export async function approvePurchaseOrder(
  userId: string,
  id: string,
  action: "approve" | "reject",
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.status !== "pending_approval") return null;

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      approvedBy: userId,
      approvedAt: new Date(),
      updatedBy: userId,
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  return {
    ...order,
    supplierName: order.supplier.name,
    items: order.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      subtotal: Number(item.subtotal),
    })),
    totalAmount: Number(order.totalAmount),
  };
}
