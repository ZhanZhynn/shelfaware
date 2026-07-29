import type { Prisma } from "@prisma/client";

// Cases at terminal stages remain historical records and retain their assignee.
export const activeAssignedCasesWhere = (
  workspaceId: string,
  assignedToId: string,
): Prisma.SourcingCaseWhereInput => ({
  workspaceId,
  assignedToId,
  OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
  stage: { notIn: ["ordered", "shipped", "received", "rejected", "cannot_source"] },
});

export const activeAssignedCasesForUserWhere = (
  assignedToId: string,
): Prisma.SourcingCaseWhereInput => ({
  assignedToId,
  OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
  stage: {
    notIn: ["ordered", "shipped", "received", "rejected", "cannot_source"],
  },
});
