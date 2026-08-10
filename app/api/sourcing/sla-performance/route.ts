import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const now = new Date();
    const records = await prisma.sourcingSlaRecord.findMany({ where: { workspaceId, ...(user.role === "sourcer" ? { ownerId: user.id } : {}) }, select: { rule: true, ownerId: true, startedAt: true, dueAt: true, completedAt: true, onTime: true } });
    // A withdrawn offer closes its superseded approval window with no on-time result.
    const completed = records.filter((record) => record.completedAt && record.onTime !== null);
    const openBreaches = records.filter((record) => !record.completedAt && record.dueAt < now);
    const breaches = completed.filter((record) => record.onTime === false).length + openBreaches.length;
    const onTime = completed.filter((record) => record.onTime).length;
    const ownerIds = [...new Set(records.flatMap((record) => record.ownerId ? [record.ownerId] : []))];
    const owners = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } }) : [];
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const waitingByOwner = ownerIds.map((ownerId) => {
      const ownerRecords = records.filter((record) => record.ownerId === ownerId);
      const waitingHours = ownerRecords.reduce((total, record) => total + ((record.completedAt || now).getTime() - record.startedAt.getTime()) / 3600000, 0);
      const owner = ownerById.get(ownerId);
      return { ownerId, ownerName: owner?.name || owner?.email || "Unknown", openCount: ownerRecords.filter((record) => !record.completedAt).length, waitingHours };
    }).sort((left, right) => right.waitingHours - left.waitingHours);
    const byRule = Object.fromEntries(["first_response", "quote_submission", "approval", "shipment"].map((rule) => {
      const ruleRecords = records.filter((record) => record.rule === rule);
      return [rule, { total: ruleRecords.length, breaches: ruleRecords.filter((record) => record.onTime === false || (!record.completedAt && record.dueAt < now)).length }];
    }));
    return NextResponse.json({ total: records.length, completed: completed.length, onTimeRate: completed.length ? onTime / completed.length : null, breachCount: breaches, openBreachCount: openBreaches.length, waitingByOwner, byRule });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SLA performance request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 });
  }
}
