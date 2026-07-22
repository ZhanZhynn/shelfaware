import { describe, expect, it } from "vitest";
import { canonicalAdminSourcingPath, safeSourcingDestination, sourcingDestination } from "./routing";

describe("sourcing routing", () => {
  it("only accepts local sourcing destinations", () => {
    expect(safeSourcingDestination("/sourcing/new?workspaceId=abc")).toBe("/sourcing/new?workspaceId=abc");
    expect(safeSourcingDestination("https://attacker.test")).toBe("/sourcing");
    expect(safeSourcingDestination("//attacker.test")).toBe("/sourcing");
  });
  it("keeps global admins inside admin sourcing", () => {
    expect(sourcingDestination({ role: "admin" })).toBe("/admin/sourcing");
    expect(canonicalAdminSourcingPath("/sourcing/abc", "?from=notification")).toBe("/admin/sourcing/abc?from=notification");
  });
});
