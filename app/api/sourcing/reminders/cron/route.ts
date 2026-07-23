import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { deliverSourcingNotification } from "@/lib/sourcing/notifications";
import { normalizeSourcingSlaConfig } from "@/lib/sourcing/sla";
import { invalidateAllServerCaches } from "@/lib/cache";

export const runtime = "nodejs";

const inactiveStages = ["archived", "rejected", "cannot_source", "received"];

function workspaceReminderDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
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
    const workspaceIds = [...new Set(cases.map((item) => item.workspaceId))];
    const workspaces = await prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, sourcingSlaConfig: true } });
    const configByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, normalizeSourcingSlaConfig(workspace.sourcingSlaConfig)]));

    let sent = 0;
    for (const item of cases) {
      const config = configByWorkspace.get(item.workspaceId) ?? normalizeSourcingSlaConfig(null);
      const overdueSla = !!item.slaDueAt && item.slaDueAt <= now;
      const escalated = overdueSla && (now.getTime() - item.slaDueAt!.getTime()) / 3600000 >= config.escalation.thresholdHours;
      const standardRecipientIds = item.assignedToId
        ? [item.assignedToId]
        : (await prisma.workspaceMember.findMany({
            where: { workspaceId: item.workspaceId, role: { in: ["admin", "sourcer"] } },
            select: { userId: true },
          })).map((member) => member.userId);
      // Re-check configured escalation IDs against membership so stale config can never notify another workspace.
      const escalationRecipientIds = escalated && config.escalation.recipientIds.length
        ? (await prisma.workspaceMember.findMany({ where: { workspaceId: item.workspaceId, userId: { in: config.escalation.recipientIds } }, select: { userId: true } })).map((member) => member.userId)
        : [];
      const recipientIds = [...new Set([...standardRecipientIds, ...escalationRecipientIds])];
      const reminderDate = workspaceReminderDate(now, config.timezone);
      const message = overdueSla
        ? `${escalated ? "SLA escalation" : "SLA"} is due for ${item.title}${item.nextAction ? `: ${item.nextAction}` : ""}`
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
          title: escalated ? "Sourcing SLA escalation" : overdueSla ? "Sourcing SLA due" : "Sourcing next action due",
          message,
          dedupeKey: `reminder:${item.id}:${userId}:${reminderDate.toISOString()}`,
          metadata: { reminderDate: reminderDate.toISOString(), escalated },
        });
        sent++;
      }
    }
    if (sent > 0) void invalidateAllServerCaches();
    return NextResponse.json({ success: true, cases: cases.length, sent });
  } catch (error) {
    logger.error("[Sourcing reminders] Cron failed", error);
    return NextResponse.json({ error: "Sourcing reminder job failed" }, { status: 500 });
  }
}
