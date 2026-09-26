import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/prisma/client";

export const apiTokenScopes = [
  "marketplace:read",
  "marketplace:live",
  "marketplace:sync",
  "marketplace:finance",
  "marketplace:pii",
] as const;

export type ApiTokenScope = (typeof apiTokenScopes)[number];

export type ApiTokenRecord = {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isApiTokenScope(value: string): value is ApiTokenScope {
  return (apiTokenScopes as readonly string[]).includes(value);
}

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer (swa_[A-Za-z0-9_-]{32,})$/.exec(authorization);
  if (!match) throw new ApiTokenAuthenticationError("Invalid bearer token");
  return match[1] ?? null;
}

export class ApiTokenAuthenticationError extends Error {}

export async function createApiToken(input: {
  userId: string;
  name: string;
  scopes: ApiTokenScope[];
  expiresAt?: Date | null;
}) {
  const token = `swa_${randomBytes(32).toString("base64url")}`;
  const record = await prisma.apiToken.create({
    data: {
      userId: input.userId,
      name: input.name,
      tokenPrefix: token.slice(0, 16),
      tokenHash: tokenHash(token),
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      userId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  return { token, record: record as ApiTokenRecord };
}

export async function resolveApiToken(token: string) {
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= new Date())) {
    throw new ApiTokenAuthenticationError("Invalid bearer token");
  }
  if (!record.user || record.user.status === "pending" || record.user.status === "rejected") {
    throw new ApiTokenAuthenticationError("Invalid bearer token");
  }
  void prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    user: record.user,
    token: {
      id: record.id,
      scopes: record.scopes.filter(isApiTokenScope),
    },
  };
}

export function publicApiToken(token: Omit<ApiTokenRecord, "scopes"> & { scopes: string[] }) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.tokenPrefix,
    scopes: token.scopes.filter(isApiTokenScope),
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}
