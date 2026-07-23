import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { ensureWorkspaceAdminRetention, requireGlobalAdmin, SourcingAccessError, withWorkspaceAdminGuard } from "@/lib/sourcing/auth";
import { activeAssignedCasesWhere } from "@/lib/sourcing/active-cases";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateAllServerCaches } from "@/lib/cache";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request); if (!user) throw new SourcingAccessError("Unauthorized", 401); await requireGlobalAdmin(user);
    const limited = await withRateLimit(request, defaultRateLimits.strict, user.id); if (limited) return limited;
    const id = (await params).id; const member = await prisma.workspaceMember.findUnique({ where: { id } });
    if (!member || member.role !== "sourcer") return NextResponse.json({ error: "Sourcer membership not found" }, { status: 404 });
    const confirmUnassign = request.nextUrl.searchParams.get("confirmUnassign") === "true";
    await withWorkspaceAdminGuard(member.workspaceId, async (tx) => {
      const current = await tx.workspaceMember.findUnique({ where: { id } });
      if (!current || current.role !== "sourcer") throw new SourcingAccessError("Sourcer membership not found", 404);
      const activeCases = await tx.sourcingCase.count({ where: activeAssignedCasesWhere(current.workspaceId, current.userId) });
      if (activeCases && !confirmUnassign) throw new SourcingAccessError(`Reassign active cases or explicitly confirm unassignment. ${activeCases} active cases remain.`, 409);
      ensureWorkspaceAdminRetention(current.role, "removed", await tx.workspaceMember.count({ where: { workspaceId: current.workspaceId, role: "admin" } }));
      if (activeCases) await tx.sourcingCase.updateMany({ where: activeAssignedCasesWhere(current.workspaceId, current.userId), data: { assignedToId: null, updatedAt: new Date() } });
      await tx.workspaceMember.delete({ where: { id } });
    });
    void invalidateAllServerCaches();
    return NextResponse.json({ status: "removed" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove sourcer" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
