import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = new URL(request.url).searchParams.get("workspaceId"); if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspaceRole(user, workspaceId, ["admin", "sourcer"]);
    const cases = await prisma.sourcingCase.findMany({ where: { workspaceId, ...(user.role === "sourcer" ? { assignedToId: user.id } : {}) }, select: { stage: true, createdAt: true, updatedAt: true, slaDueAt: true, quotes: { select: { status: true } } } });
    const now = new Date(); const byStage = cases.reduce<Record<string, number>>((result, item) => ({ ...result, [item.stage]: (result[item.stage] || 0) + 1 }), {});
    const completed = cases.filter((item) => ["received", "rejected", "cannot_source"].includes(item.stage));
    const hours = completed.map((item) => ((item.updatedAt || now).getTime() - item.createdAt.getTime()) / 3600000);
    return NextResponse.json({ totalCases: cases.length, byStage, submittedQuotes: cases.flatMap((item) => item.quotes).filter((quote) => quote.status === "submitted").length, overdueCases: cases.filter((item) => item.slaDueAt && item.slaDueAt < now && !["received", "rejected", "cannot_source", "archived"].includes(item.stage)).length, averageCycleHours: hours.length ? hours.reduce((sum, value) => sum + value, 0) / hours.length : null });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Analytics request failed" }, { status: error instanceof SourcingAccessError ? error.status : 500 }); }
}
