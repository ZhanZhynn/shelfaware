import { prisma } from "@/prisma/client";
import { createNotification } from "@/prisma/notification";
import { queueEmailNotification } from "@/lib/email/queue";
import type { NotificationType } from "@/types/notification";

type SourcingNotificationKind =
  | "assignment"
  | "quote"
  | "decision"
  | "comment"
  | "sla";

const notificationType: Record<SourcingNotificationKind, NotificationType> = {
  assignment: "sourcing_assignment",
  quote: "sourcing_quote",
  decision: "sourcing_decision",
  comment: "sourcing_comment",
  sla: "sourcing_sla_reminder",
};

export async function sourcingAdmins(workspaceId: string) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: "admin" },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

export function sourcingCaseLink(caseId: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  let origin = "http://localhost:3000";
  try {
    const url = new URL(configuredOrigin || origin);
    if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
  } catch {
    // Fall back rather than putting an unsafe configured value in an email link.
  }
  return `${origin}/sourcing/${encodeURIComponent(caseId)}`;
}

export async function deliverSourcingNotification(input: {
  workspaceId: string;
  caseId: string;
  recipientIds: string[];
  excludeUserId?: string;
  kind: SourcingNotificationKind;
  title: string;
  message: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}) {
  const recipientIds = [...new Set(input.recipientIds)].filter(
    (userId) => userId && userId !== input.excludeUserId,
  );
  if (!recipientIds.length) return 0;

  const recipients = await prisma.user.findMany({
    where: { id: { in: recipientIds } },
    select: { id: true, email: true, name: true },
  });
  const link = sourcingCaseLink(input.caseId);

  let delivered = 0;
  await Promise.all(recipients.map(async (recipient) => {
    // The event/action key makes retries idempotent without adding a schema constraint.
    const existing = await prisma.notification.findMany({
      where: { userId: recipient.id, type: notificationType[input.kind], link },
      select: { metadata: true },
    });
    if (existing.some((notification) =>
      (notification.metadata as { sourcingDeliveryKey?: unknown } | null)?.sourcingDeliveryKey === input.dedupeKey,
    )) return;

    await createNotification({
      userId: recipient.id,
      type: notificationType[input.kind],
      title: input.title,
      message: input.message,
      link,
      metadata: {
        workspaceId: input.workspaceId,
        sourcingCaseId: input.caseId,
        sourcingDeliveryKey: input.dedupeKey,
        ...input.metadata,
      },
    });
    delivered++;
    await queueEmailNotification({
      type: "sourcing_notification",
      data: { title: input.title, message: input.message, link },
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      userId: recipient.id,
    });
  }));
  return delivered;
}
