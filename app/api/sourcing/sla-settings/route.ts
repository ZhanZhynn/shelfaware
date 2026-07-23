import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { normalizeSourcingSlaConfig } from "@/lib/sourcing/sla";
import { sourcingSlaSettingsSchema } from "@/lib/validations/sourcing";
import { ZodError } from "zod";
import { invalidateAllServerCaches } from "@/lib/cache";

function failure(error: unknown) {
  const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "SLA settings request failed" }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { sourcingSlaConfig: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const eligibleRecipients = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ config: normalizeSourcingSlaConfig(workspace.sourcingSlaConfig), eligibleRecipients });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin"]);
    const config = sourcingSlaSettingsSchema.parse(await request.json());
    if (config.escalation.recipientIds.length) {
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId, userId: { in: config.escalation.recipientIds } }, select: { userId: true } });
      if (members.length !== config.escalation.recipientIds.length) return NextResponse.json({ error: "Escalation recipients must be workspace members" }, { status: 400 });
    }
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { sourcingSlaConfig: config as Prisma.InputJsonValue, updatedAt: new Date() },
      select: { sourcingSlaConfig: true },
    });
    void invalidateAllServerCaches();
    return NextResponse.json(normalizeSourcingSlaConfig(workspace.sourcingSlaConfig));
  } catch (error) { return failure(error); }
}
