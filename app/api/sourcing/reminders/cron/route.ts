import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { deliverSourcingNotification } from "@/lib/sourcing/notifications";

export const runtime = "nodejs";

const inactiveStages = ["archived", "rejected", "cannot_source", "received"];

function startOfToday(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : "";
  return !!authorization && authorization.length === expected.length && crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const reminderDate = startOfToday(now);
    const cases = await prisma.sourcingCase.findMany({
      where: {
        stage: { notIn: inactiveStages },
        OR: [
          { nextActionAt: { not: null, lte: now } },
          { slaDueAt: { not: null, lte: now } },
        ],
      },
      select: { id: true, workspaceId: true, title: true, assignedToId: true, nextAction: true, nextActionAt: true, slaDueAt: true },
    });

    let sent = 0;
    for (const item of cases) {
      const recipientIds = item.assignedToId
        ? [item.assignedToId]
        : (await prisma.workspaceMember.findMany({
            where: { workspaceId: item.workspaceId, role: { in: ["admin", "sourcer"] } },
            select: { userId: true },
          })).map((member) => member.userId);
      const overdueSla = item.slaDueAt && item.slaDueAt <= now;
      const message = overdueSla
        ? `SLA is due for ${item.title}${item.nextAction ? `: ${item.nextAction}` : ""}`
        : `Next action is due for ${item.title}${item.nextAction ? `: ${item.nextAction}` : ""}`;

      for (const userId of recipientIds) {
        try {
          await prisma.sourcingReminder.create({ data: { caseId: item.id, userId, reminderDate } });
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") continue;
          throw error;
        }
        await deliverSourcingNotification({
          workspaceId: item.workspaceId,
          caseId: item.id,
          recipientIds: [userId],
          kind: "sla",
          title: overdueSla ? "Sourcing SLA due" : "Sourcing next action due",
          message,
          dedupeKey: `reminder:${item.id}:${userId}:${reminderDate.toISOString()}`,
          metadata: { reminderDate: reminderDate.toISOString() },
        });
        sent++;
      }
    }
    return NextResponse.json({ success: true, cases: cases.length, sent });
  } catch (error) {
    logger.error("[Sourcing reminders] Cron failed", error);
    return NextResponse.json({ error: "Sourcing reminder job failed" }, { status: 500 });
  }
}
