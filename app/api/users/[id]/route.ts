/**
 * User Detail API Route Handler (admin User Management)
 * GET /api/users/:id — fetch one user (admin-only)
 * PUT /api/users/:id — update user role/name (admin-only)
 * DELETE /api/users/:id — delete user (admin-only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import {
  getUserById,
  updateUserAdmin,
  deleteUserAdmin,
} from "@/prisma/user-admin";
import { updateUserAdminSchema } from "@/lib/validations";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createAuditLog } from "@/prisma/audit-log";
import { prisma } from "@/prisma/client";
import { activeAssignedCasesForUserWhere } from "@/lib/sourcing/active-cases";
import type { UserForAdmin, UserOverview, UpdateUserAdminInput } from "@/types";

function transform(
  r: Awaited<ReturnType<typeof getUserById>> & {},
): UserForAdmin {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    username: r.username,
    role: r.role as UserForAdmin["role"],
    isSuperAdmin: r.isSuperAdmin,
    status: (r.status ?? "approved") as UserForAdmin["status"],
    image: r.image,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
    workspaceAdminOf: r.workspaceMemberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
    })),
  };
}

/**
 * GET /api/users/:id
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const record = await getUserById(id);
    if (!record) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Spent: orders where this user is the client (clientId = id) OR creator with no client set (userId = id, clientId null)
    const ordersForSpent = prisma.order.findMany({
      where: {
        OR: [{ clientId: id }, { userId: id, clientId: null }],
      },
      select: { total: true },
    });
    // Due: invoices where this user is the client (clientId = id) OR creator with no client set (userId = id, clientId null)
    const invoicesForDue = prisma.invoice.findMany({
      where: {
        OR: [{ clientId: id }, { userId: id, clientId: null }],
      },
      select: { amountDue: true },
    });

    const [
      orderCountAsCreator,
      orderCountAsClient,
      invoiceCountAsCreator,
      invoiceCountAsClient,
      ordersAsCreator,
      ordersAsClient,
      invoicesAsClient,
      ordersForSpentResult,
      invoicesForDueResult,
      productCount,
      supplierCount,
      categoryCount,
      warehouseCount,
      suppliersForUser,
    ] = await Promise.all([
      prisma.order.count({ where: { userId: id } }),
      prisma.order.count({ where: { clientId: id } }),
      prisma.invoice.count({ where: { userId: id } }),
      prisma.invoice.count({ where: { clientId: id } }),
      prisma.order.findMany({
        where: { userId: id },
        select: { total: true },
      }),
      prisma.order.findMany({
        where: { clientId: id },
        select: { total: true },
      }),
      prisma.invoice.findMany({
        where: { clientId: id },
        select: { total: true, amountDue: true },
      }),
      ordersForSpent,
      invoicesForDue,
      prisma.product.count({ where: { userId: id } }),
      prisma.supplier.count({ where: { userId: id } }),
      prisma.category.count({ where: { userId: id } }),
      prisma.warehouse.count({ where: { userId: id } }),
      prisma.supplier.findMany({
        where: { userId: id },
        select: { id: true },
      }),
    ]);

    const supplierIds = suppliersForUser.map((s) => s.id);
    const supplierOrderItems =
      supplierIds.length > 0
        ? await prisma.orderItem.findMany({
            where: { product: { supplierId: { in: supplierIds } } },
            select: { subtotal: true },
          })
        : [];

    const revenueFromOrdersCreated = ordersAsCreator.reduce(
      (s, o) => s + (o.total ?? 0),
      0,
    );
    const supplierRevenue = supplierOrderItems.reduce(
      (s, i) => s + (i.subtotal ?? 0),
      0,
    );
    const totalRevenue = revenueFromOrdersCreated + supplierRevenue;
    const totalSpent = ordersForSpentResult.reduce(
      (s, o) => s + (o.total ?? 0),
      0,
    );
    const totalDue = invoicesForDueResult.reduce(
      (s, i) => s + (i.amountDue ?? 0),
      0,
    );
    const overview: UserOverview = {
      orderCount: orderCountAsCreator + orderCountAsClient,
      invoiceCount: invoiceCountAsCreator + invoiceCountAsClient,
      totalRevenue,
      totalSpent,
      totalDue,
      productCount,
      supplierCount,
      categoryCount,
      warehouseCount,
    };

    return NextResponse.json({ ...transform(record), overview });
  } catch (error) {
    logger.error("Error fetching user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/users/:id
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const existing = await getUserById(id);
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = updateUserAdminSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Invalid user update data", {
        errors: parsed.error.errors,
      });
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.errors },
        { status: 400 },
      );
    }

    const data = parsed.data;
    if (
      existing.role === "admin" &&
      existing.isSuperAdmin &&
      ((data.role !== undefined && data.role !== "admin") ||
        data.isSuperAdmin === false)
    ) {
      const superAdminCount = await prisma.user.count({
        where: { role: "admin", isSuperAdmin: true },
      });
      if (superAdminCount <= 1)
        return NextResponse.json(
          { error: "At least one Super admin must remain" },
          { status: 409 },
        );
    }
    if (
      existing.role === "sourcer" &&
      data.role !== undefined &&
      data.role !== "sourcer"
    ) {
      const activeCaseCount = await prisma.sourcingCase.count({
        where: activeAssignedCasesForUserWhere(id),
      });
      if (activeCaseCount)
        return NextResponse.json(
          {
            error: `Cannot change this Sourcer's role while they have ${activeCaseCount} active assigned sourcing case${activeCaseCount === 1 ? "" : "s"}. Reassign those cases first.`,
          },
          { status: 409 },
        );
    }
    if (data.isSuperAdmin !== undefined && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: "Only Super admins can change Super admin access" },
        { status: 403 },
      );
    }
    const updatePayload: UpdateUserAdminInput = {};
    if (data.role !== undefined) updatePayload.role = data.role;
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.isSuperAdmin !== undefined) updatePayload.isSuperAdmin = data.isSuperAdmin;
    if ("status" in data && data.status !== undefined) {
      updatePayload.status = data.status;
    }
    const updated = await updateUserAdmin(id, updatePayload);

    createAuditLog({
      userId: session.id,
      action: "update",
      entityType: "user",
      entityId: id,
    }).catch(() => {});

    const { invalidateAllServerCaches } = await import("@/lib/cache");
    await invalidateAllServerCaches().catch(() => {});

    return NextResponse.json(transform(updated));
  } catch (error) {
    logger.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/users/:id
 * Delete a user (admin-only). Cannot delete self.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Prevent admin from deleting themselves
    if (id === session.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 },
      );
    }

    const existing = await getUserById(id);
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (existing.role === "admin" && existing.isSuperAdmin) {
      if (!session.isSuperAdmin)
        return NextResponse.json(
          { error: "Only Super admins can delete a Super admin" },
          { status: 403 },
        );
      const superAdminCount = await prisma.user.count({
        where: { role: "admin", isSuperAdmin: true },
      });
      if (superAdminCount <= 1)
        return NextResponse.json(
          { error: "At least one Super admin must remain" },
          { status: 409 },
        );
    }
    if (existing.role === "sourcer") {
      const activeCaseCount = await prisma.sourcingCase.count({
        where: activeAssignedCasesForUserWhere(id),
      });
      if (activeCaseCount)
        return NextResponse.json(
          {
            error: `Cannot delete this Sourcer while they have ${activeCaseCount} active assigned sourcing case${activeCaseCount === 1 ? "" : "s"}. Reassign those cases first.`,
          },
          { status: 409 },
        );
    }
    const deleted = await deleteUserAdmin(id, session.id);

    createAuditLog({
      userId: session.id,
      action: "delete",
      entityType: "user",
      entityId: id,
    }).catch(() => {});

    const { invalidateAllServerCaches } = await import("@/lib/cache");
    await invalidateAllServerCaches().catch(() => {});

    return NextResponse.json(transform(deleted));
  } catch (error) {
    logger.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 },
    );
  }
}
