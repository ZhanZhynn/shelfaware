import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getStockMovementsForUser } from "@/prisma/stock-movement";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId") || undefined;
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const sourceType = searchParams.get("sourceType") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(100, parseInt(limitParam, 10)) : 50;

    const memberships = session.role === "admin" ? [] : await prisma.workspaceMember.findMany({ where: { userId: session.id, role: { in: ["admin", "warehouse"] } }, select: { workspaceId: true } });
    const movements = await getStockMovementsForUser(session.id, {
      productId,
      warehouseId,
      sourceType,
      limit,
    }, session.role === "admin" ? undefined : memberships.map((member) => member.workspaceId), session.role === "admin");

    return NextResponse.json(movements);
  } catch (error) {
    logger.error("[Stock Movements] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stock movements" },
      { status: 500 },
    );
  }
}
