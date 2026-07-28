import { describe, expect, it } from "vitest";
import {
  activeAssignedCasesForUserWhere,
  activeAssignedCasesWhere,
} from "./active-cases";

describe("activeAssignedCasesWhere", () => {
  it("excludes terminal and archived case history from unassignment", () => {
    expect(activeAssignedCasesWhere("workspace", "sourcer")).toEqual({
      workspaceId: "workspace",
      assignedToId: "sourcer",
      archivedAt: null,
      stage: { notIn: ["ordered", "shipped", "received", "rejected", "cannot_source"] },
    });
  });

  it("matches active assignments across all legacy workspaces", () => {
    expect(activeAssignedCasesForUserWhere("sourcer")).toEqual({
      assignedToId: "sourcer",
      archivedAt: null,
      stage: { notIn: ["ordered", "shipped", "received", "rejected", "cannot_source"] },
    });
  });
});
