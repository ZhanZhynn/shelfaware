import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { apiTokenScopes, createApiToken, isApiTokenScope, publicApiToken } from "@/lib/auth/api-token";
import { prisma } from "@/prisma/client";

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string()).min(1).max(apiTokenScopes.length).refine((scopes) => scopes.every(isApiTokenScope), "Invalid token scope"),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await withRateLimit(request, defaultRateLimits.strict, `api-tokens:list:${user.id}`);
  if (limited) return limited;
  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.id },
    select: { id: true, userId: true, name: true, tokenPrefix: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ tokens: tokens.map((token) => publicApiToken(token)) });
}

export async function POST(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await withRateLimit(request, defaultRateLimits.strict, `api-tokens:create:${user.id}`);
  if (limited) return limited;

  const parsed = createTokenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) return NextResponse.json({ error: "expiresAt must be in the future" }, { status: 422 });

  const { token, record } = await createApiToken({ userId: user.id, name: parsed.data.name, scopes: [...new Set(parsed.data.scopes)], expiresAt });
  void createAuditLog({
    userId: user.id,
    action: "create",
    entityType: "api_token",
    entityId: record.id,
    details: { name: record.name, scopes: record.scopes, expiresAt: record.expiresAt?.toISOString() ?? null },
  }).catch(() => {});
  return NextResponse.json({ token, apiToken: publicApiToken(record) }, { status: 201 });
}
