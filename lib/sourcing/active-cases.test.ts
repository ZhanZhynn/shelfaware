import { describe, expect, it } from "vitest";
import { activeAssignedCasesWhere } from "./active-cases";

describe("activeAssignedCasesWhere", () => {
  it("excludes terminal and archived case history from unassignment", () => {
    expect(activeAssignedCasesWhere("workspace", "sourcer")).toEqual({
      workspaceId: "workspace",
      assignedToId: "sourcer",
      archivedAt: null,
      stage: { notIn: ["ordered", "shipped", "received", "rejected", "cannot_source"] },
    });
  });
});
