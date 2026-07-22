import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import {
  getPurchaseOrdersForUser,
  createPurchaseOrder,
} from "@/prisma/purchase-order";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const supplierId = searchParams.get("supplierId") || undefined;
    const memberships = session.role === "admin" ? [] : await prisma.workspaceMember.findMany({ where: { userId: session.id, role: { in: ["admin", "warehouse"] } }, select: { workspaceId: true } });

    const cacheKey = `purchaseOrders:list:${session.id}:${status || "all"}:${supplierId || "all"}:${memberships.map((member) => member.workspaceId).join(",")}`;
    const cached = await getCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const data = await getPurchaseOrdersForUser(session.id, { status, supplierId, workspaceIds: session.role === "admin" ? undefined : memberships.map((member) => member.workspaceId), globalAdmin: session.role === "admin" });
    await setCache(cacheKey, data, 120);

    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error fetching purchase orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch purchase orders" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { supplierId, notes, items, workspaceId } = body;

    if (!supplierId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "supplierId and at least one item are required" },
        { status: 400 },
      );
    }

    if (workspaceId) await requireWorkspaceRole(session, workspaceId, ["admin"]);
    const data = await createPurchaseOrder(session.id, { supplierId, notes, items, workspaceId });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    logger.error("Error creating purchase order:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create purchase order" },
      { status: 500 },
    );
  }
}
