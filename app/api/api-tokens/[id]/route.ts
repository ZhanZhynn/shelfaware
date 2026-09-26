import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { prisma } from "@/prisma/client";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await withRateLimit(request, defaultRateLimits.strict, `api-tokens:revoke:${user.id}`);
  if (limited) return limited;
  const { id } = await params;
  const result = await prisma.apiToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!result.count) return NextResponse.json({ error: "Token not found" }, { status: 404 });
  void createAuditLog({ userId: user.id, action: "delete", entityType: "api_token", entityId: id, details: { operation: "revoke" } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
