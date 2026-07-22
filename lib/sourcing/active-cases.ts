import type { Prisma } from "@prisma/client";

// Cases at terminal stages remain historical records and retain their assignee.
export const activeAssignedCasesWhere = (
  workspaceId: string,
  assignedToId: string,
): Prisma.SourcingCaseWhereInput => ({
  workspaceId,
  assignedToId,
  archivedAt: null,
  stage: { notIn: ["ordered", "rejected", "cannot_source"] },
});
