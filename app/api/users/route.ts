/**
 * Users API Route Handler (admin User Management)
 * GET /api/users — list all users (admin-only)
 * POST /api/users — create new user (admin-only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import {
  getAllUsers,
  createUserAdmin,
  emailExists,
  usernameExists,
} from "@/prisma/user-admin";
import { getCache, setCache, cacheKeys } from "@/lib/cache";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createUserAdminSchema } from "@/lib/validations/user-management";
import type { UserForAdmin } from "@/types";

function transform(
  r: Awaited<ReturnType<typeof getAllUsers>>[number],
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
 * GET /api/users
 * Fetch all users (admin-only). Uses cache when no filters.
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as
      "pending" | "approved" | "rejected" | null;

    // Only cache when no filters are applied
    if (!status) {
      const cacheKey = cacheKeys.userManagement.list({});
      const cached = await getCache<UserForAdmin[]>(cacheKey);
      if (cached) return NextResponse.json(cached);

      const records = await getAllUsers();
      const result = records.map(transform);
      await setCache(cacheKey, result, 300);
      return NextResponse.json(result);
    }

    // With filters, skip cache
    const records = await getAllUsers();
    const filtered = records
      .map(transform)
      .filter((u) => !status || u.status === status);
    return NextResponse.json(filtered);
  } catch (error) {
    logger.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/users
 * Create a new user (admin-only)
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const validation = createUserAdminSchema.safeParse(body);
    if (!validation.success) {
      logger.warn("Invalid user creation data", {
        errors: validation.error.errors,
      });
      return NextResponse.json(
        { error: "Invalid request body", details: validation.error.errors },
        { status: 400 },
      );
    }

    const data = validation.data;
    if (data.accountType === "super_admin" && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: "Only Super admins can create Super admins" },
        { status: 403 },
      );
    }

    // Check if email already exists
    if (await emailExists(data.email)) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    // Check if username already exists (if provided)
    if (data.username && (await usernameExists(data.username))) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }

    const created = await createUserAdmin(data);
    const result = transform(created);

    createAuditLog({
      userId: session.id,
      action: "create",
      entityType: "user",
      entityId: created.id,
    }).catch(() => {});

    const { invalidateAllServerCaches } = await import("@/lib/cache");
    await invalidateAllServerCaches().catch(() => {});

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logger.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 },
    );
  }
}
