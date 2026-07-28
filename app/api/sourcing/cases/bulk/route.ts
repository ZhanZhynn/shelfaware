import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { z } from "zod";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateAllServerCaches } from "@/lib/cache";

const schema = z
  .object({
    workspaceId: z.string().min(1),
    caseIds: z.array(z.string().min(1)).min(1).max(100),
    assignedToId: z.string().min(1).optional(),
    nextActionAt: z.coerce.date().nullable().optional(),
    slaDueAt: z.coerce.date().nullable().optional(),
  })
  .refine(
    (value) =>
      value.assignedToId ||
      value.nextActionAt !== undefined ||
      value.slaDueAt !== undefined,
    "Select an assignee or due date",
  );
export async function PATCH(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(
      request,
      defaultRateLimits.strict,
      user.id,
    );
    if (limited) return limited;
    const input = schema.parse(await request.json());
    await requireWorkspaceRole(user, input.workspaceId, ["admin"]);
    if (input.assignedToId) {
      const sourcer = await prisma.user.findFirst({
        where: {
          id: input.assignedToId,
          role: "sourcer",
          status: "approved",
        },
        select: { id: true },
      });
      if (!sourcer)
        return NextResponse.json(
          { error: "Assignee must be an approved Sourcer" },
          { status: 400 },
        );
    }
    const data = {
      ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
      ...(input.nextActionAt !== undefined
        ? { nextActionAt: input.nextActionAt }
        : {}),
      ...(input.slaDueAt !== undefined ? { slaDueAt: input.slaDueAt } : {}),
      version: { increment: 1 },
      updatedAt: new Date(),
    };
    const result = await prisma.sourcingCase.updateMany({
      where: { id: { in: input.caseIds }, workspaceId: input.workspaceId },
      data,
    });
    void invalidateAllServerCaches();
    return NextResponse.json({ updated: result.count });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk update failed" },
      { status: error instanceof SourcingAccessError ? error.status : 400 },
    );
  }
}
