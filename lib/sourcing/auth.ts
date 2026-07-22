import { prisma } from "@/prisma/client";
import type { Prisma } from "@prisma/client";

export const workspaceRoles = ["admin", "sourcer", "warehouse", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export class SourcingAccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

export async function requireWorkspaceRole(
  user: { id: string; role: string | null },
  workspaceId: string,
  allowed: readonly WorkspaceRole[],
) {
  // Global admins retain operational access while workspace roles govern everyone else.
  if (user.role === "admin") return { role: "admin" as WorkspaceRole, globalAdmin: true };
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (!membership || !workspaceRoles.includes(membership.role as WorkspaceRole)) {
    throw new SourcingAccessError("Workspace membership is required");
  }
  if (!allowed.includes(membership.role as WorkspaceRole)) {
    throw new SourcingAccessError("Your workspace role cannot perform this action");
  }
  return { role: membership.role as WorkspaceRole, globalAdmin: false };
}

export async function requireGlobalAdmin(user: { role: string | null }) {
  if (user.role !== "admin") throw new SourcingAccessError("Global administrator access is required");
}

export function ensureWorkspaceAdminRetention(
  currentRole: string | undefined,
  nextRole: string,
  adminCount: number,
) {
  if (currentRole === "admin" && nextRole !== "admin" && adminCount <= 1) {
    throw new SourcingAccessError("A workspace must retain at least one admin", 409);
  }
}

function isTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    ((error as { code?: string | number }).code === "P2034" || (error as { code?: string | number }).code === 112);
}

/**
 * Serializes membership changes through a workspace write. Mongo transactions
 * abort conflicting writes, then retrying makes the losing request re-check
 * the latest admin count rather than allowing two final-admin demotions.
 */
export async function withWorkspaceAdminGuard<T>(
  workspaceId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: new Date() } });
        return operation(tx);
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Workspace membership transaction failed");
}
