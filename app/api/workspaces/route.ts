import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await withRateLimit(request, defaultRateLimits.strict, user.id);
  if (limited) return limited;
  const where =
    user.role === "admin" ? {} : { members: { some: { userId: user.id } } };
  const workspaces = await prisma.workspace.findMany({
    where,
    include: {
      members: { where: { userId: user.id }, select: { role: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    workspaces.map((workspace) => ({
      ...workspace,
      canAssign:
        user.role === "admin" || workspace.members[0]?.role === "admin",
    })),
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await withRateLimit(
    request,
    defaultRateLimits.strict,
    `workspaces:create:${user.id}`,
  );
  if (limited) return limited;
  const { name } = await request.json();
  if (typeof name !== "string" || !name.trim())
    return NextResponse.json(
      { error: "Workspace name is required" },
      { status: 400 },
    );
  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: { name: name.trim(), ownerId: user.id },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: created.id, userId: user.id, role: "admin" },
    });
    return created;
  });
  return NextResponse.json(workspace, { status: 201 });
}
