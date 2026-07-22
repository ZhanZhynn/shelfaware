import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { createSourcingCase } from "@/lib/sourcing/commands";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";
import { sourcingCaseSchema } from "@/lib/validations/sourcing";
import { normalizeSourcingListCase } from "@/lib/sourcing/contracts";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { ZodError } from "zod";

export const sourcingListInclude = { quotes: { orderBy: { revision: "desc" as const }, take: 1 }, orders: true };

function failure(error: unknown) {
  const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing request failed" }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const cases = await prisma.sourcingCase.findMany({ where: { workspaceId }, include: sourcingListInclude, orderBy: { updatedAt: "desc" } });
    const assigneeIds = [...new Set(cases.flatMap((item) => item.assignedToId ? [item.assignedToId] : []))];
    const assignees = assigneeIds.length ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true, email: true } }) : [];
    const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee]));
    return NextResponse.json(cases.map((item) => normalizeSourcingListCase({ ...item, assignee: item.assignedToId ? assigneeById.get(item.assignedToId) ?? null : null })));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(request, defaultRateLimits.strict, user.id);
    if (limited) return limited;
    const body = sourcingCaseSchema.parse(await request.json());
    const sourcingCase = await createSourcingCase(user, body);
    void invalidateAllServerCaches();
    return NextResponse.json(normalizeSourcingListCase(sourcingCase), { status: 201 });
  } catch (error) { return failure(error); }
}
