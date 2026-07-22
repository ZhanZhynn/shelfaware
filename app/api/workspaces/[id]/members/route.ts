import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { ensureWorkspaceAdminRetention, requireWorkspaceRole, SourcingAccessError, withWorkspaceAdminGuard, workspaceRoles } from "@/lib/sourcing/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(request, defaultRateLimits.strict, user.id);
    if (limited) return limited;
    const workspaceId = (await params).id;
    await requireWorkspaceRole(user, workspaceId, ["admin"]);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId }, orderBy: { role: "asc" },
      select: { userId: true, role: true, user: { select: { name: true, email: true, image: true } } },
    });
    return NextResponse.json(members.map(({ userId, role, user }) => ({ id: userId, role, name: user.name, email: user.email, image: user.image })));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Membership lookup failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(
      request,
      defaultRateLimits.strict,
      `workspaces:members:update:${user.id}`,
    );
    if (limited) return limited;
    const workspaceId = (await params).id;
    await requireWorkspaceRole(user, workspaceId, ["admin"]);
    const { userId, role } = await request.json();
    if (typeof userId !== "string" || !workspaceRoles.includes(role)) return NextResponse.json({ error: "Valid userId and role are required" }, { status: 400 });
    const member = await withWorkspaceAdminGuard(workspaceId, async (tx) => {
      const existing = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
      if (existing?.role === "admin" && role !== "admin") {
        const adminCount = await tx.workspaceMember.count({ where: { workspaceId, role: "admin" } });
        ensureWorkspaceAdminRetention(existing.role, role, adminCount);
      }
      return tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId, userId } }, create: { workspaceId, userId, role }, update: { role, updatedAt: new Date() } });
    });
    return NextResponse.json(member);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Membership update failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
