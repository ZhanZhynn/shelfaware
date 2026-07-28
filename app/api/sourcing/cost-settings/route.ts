import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { normalizeSourcingCostConfig } from "@/lib/sourcing/landed-cost";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { sourcingCostSettingsSchema } from "@/lib/validations/sourcing";
import { ZodError } from "zod";
import { invalidateAllServerCaches } from "@/lib/cache";

function failure(error: unknown) {
  const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Cost settings request failed" }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { sourcingCostConfig: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    return NextResponse.json({ config: normalizeSourcingCostConfig(workspace.sourcingCostConfig) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin"]);
    const config = sourcingCostSettingsSchema.parse(await request.json());
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { sourcingCostConfig: config as Prisma.InputJsonValue, updatedAt: new Date() },
      select: { sourcingCostConfig: true },
    });
    void invalidateAllServerCaches();
    return NextResponse.json(normalizeSourcingCostConfig(workspace.sourcingCostConfig));
  } catch (error) {
    return failure(error);
  }
}
