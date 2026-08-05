import type { Prisma } from "@prisma/client";

// Cases at terminal stages remain historical records and retain their assignee.
export const activeAssignedCasesWhere = (
  workspaceId: string,
  assignedToId: string,
): Prisma.SourcingCaseWhereInput => ({
  workspaceId,
  assignedToId,
  OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
  stage: { notIn: ["ordered", "shipping", "received", "rejected", "cannot_source", "cancelled"] },
});

export const activeAssignedCasesForUserWhere = (
  assignedToId: string,
): Prisma.SourcingCaseWhereInput => ({
  assignedToId,
  OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
  stage: {
    notIn: ["ordered", "shipping", "received", "rejected", "cannot_source", "cancelled"],
  },
});
