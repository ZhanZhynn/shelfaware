import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { normalizeSupplierName } from "@/lib/suppliers/normalization";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const name = params.get("name")?.trim();
    const workspaceId = params.get("workspaceId") ?? undefined;
    const excludeId = params.get("excludeId") ?? undefined;
    if (!name || name.length < 2) return NextResponse.json([]);
    if (workspaceId) await requireWorkspaceRole(session, workspaceId, ["admin", "sourcer", "warehouse", "viewer"]);
    const normalizedName = normalizeSupplierName(name);
    const suppliers = await prisma.supplier.findMany({
      where: { ...(workspaceId ? { workspaceId } : { userId: session.id }), ...(excludeId ? { id: { not: excludeId } } : {}), normalizedName },
      select: { id: true, name: true, status: true, contactEmail: true, country: true },
      take: 8,
    });
    return NextResponse.json(suppliers);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Duplicate check failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
