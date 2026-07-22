import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { invalidateAllServerCaches } from "@/lib/cache";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import { sourcingCommentSchema } from "@/lib/validations/sourcing";
import { deliverSourcingNotification } from "@/lib/sourcing/notifications";

const commentInclude = { author: { select: { id: true, name: true, email: true, image: true } } };

function failure(error: unknown) {
  const status = error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing comment failed" }, { status });
}

async function caseForUser(request: NextRequest, id: string) {
  const user = await getSessionFromRequest(request);
  if (!user) throw new SourcingAccessError("Unauthorized", 401);
  const sourcingCase = await prisma.sourcingCase.findUnique({ where: { id }, select: { id: true, title: true, workspaceId: true, assignedToId: true } });
  if (!sourcingCase) throw new SourcingAccessError("Sourcing case not found", 404);
  await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin", "sourcer"]);
  return { user, sourcingCase };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { sourcingCase } = await caseForUser(request, (await params).id);
    const comments = await prisma.sourcingComment.findMany({ where: { caseId: sourcingCase.id, workspaceId: sourcingCase.workspaceId }, include: commentInclude, orderBy: { createdAt: "asc" } });
    return NextResponse.json(comments);
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, sourcingCase } = await caseForUser(request, (await params).id);
    const limited = await withRateLimit(request, defaultRateLimits.strict, `sourcing:comments:${user.id}`);
    if (limited) return limited;
    const input = sourcingCommentSchema.parse(await request.json());
    const membershipCount = input.mentionedUserIds.length ? await prisma.workspaceMember.count({ where: { workspaceId: sourcingCase.workspaceId, userId: { in: input.mentionedUserIds } } }) : 0;
    if (membershipCount !== input.mentionedUserIds.length) throw new SourcingAccessError("Mentioned users must be workspace members", 400);
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.sourcingComment.create({ data: { caseId: sourcingCase.id, workspaceId: sourcingCase.workspaceId, authorId: user.id, body: input.body, mentionedUserIds: input.mentionedUserIds }, include: commentInclude });
      await tx.sourcingEvent.create({ data: { caseId: sourcingCase.id, workspaceId: sourcingCase.workspaceId, actorId: user.id, type: "comment_created", payload: { commentId: created.id, mentionedUserIds: input.mentionedUserIds } } });
      return created;
    });
    const recipients = [...new Set([...input.mentionedUserIds, sourcingCase.assignedToId].filter((id): id is string => !!id && id !== user.id))];
    void deliverSourcingNotification({
      workspaceId: sourcingCase.workspaceId,
      caseId: sourcingCase.id,
      recipientIds: recipients,
      excludeUserId: user.id,
      kind: "comment",
      title: `New comment on ${sourcingCase.title}`,
      message: `${comment.author.name || comment.author.email} commented on this sourcing case.`,
      dedupeKey: `comment:${comment.id}`,
      metadata: { commentId: comment.id, mentionedUserIds: input.mentionedUserIds },
    }).catch((error) => logger.error("[Sourcing] Comment notification delivery failed", error));
    void invalidateAllServerCaches();
    return NextResponse.json(comment, { status: 201 });
  } catch (error) { return failure(error); }
}
