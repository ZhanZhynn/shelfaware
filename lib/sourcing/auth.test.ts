import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  workspaceUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({
  prisma: {
    workspaceMember: { findUnique: mocks.findUnique },
    workspace: { update: mocks.workspaceUpdate },
    $transaction: mocks.transaction,
  },
}));

import { ensureWorkspaceAdminRetention, requireWorkspaceRole, SourcingAccessError, withWorkspaceAdminGuard } from "./auth";

describe("sourcing read access", () => {
  beforeEach(() => mocks.findUnique.mockReset());

  it("allows global admins without workspace membership", async () => {
    await expect(requireWorkspaceRole({ id: "admin", role: "admin" }, "workspace", ["admin", "sourcer"])).resolves.toMatchObject({ globalAdmin: true });
  });

  it.each(["warehouse", "viewer"])("rejects %s from sourcing payloads", async (role) => {
    mocks.findUnique.mockResolvedValue({ role });
    await expect(requireWorkspaceRole({ id: "member", role: "user" }, "workspace", ["admin", "sourcer"])).rejects.toBeInstanceOf(SourcingAccessError);
  });

  it("allows sourcers to read sourcing payloads", async () => {
    mocks.findUnique.mockResolvedValue({ role: "sourcer" });
    await expect(requireWorkspaceRole({ id: "member", role: "user" }, "workspace", ["admin", "sourcer"])).resolves.toMatchObject({ role: "sourcer" });
  });
});

describe("workspace admin retention", () => {
  it("prohibits demoting the final workspace admin", () => {
    expect(() => ensureWorkspaceAdminRetention("admin", "sourcer", 1)).toThrow(SourcingAccessError);
  });

  it("permits a demotion when another admin remains", () => {
    expect(() => ensureWorkspaceAdminRetention("admin", "sourcer", 2)).not.toThrow();
  });

  it("retries a conflicting workspace guard transaction before applying a demotion", async () => {
    const transactionClient = { workspace: { update: mocks.workspaceUpdate } };
    mocks.transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce((operation) => operation(transactionClient));

    await expect(withWorkspaceAdminGuard("workspace", async () => "updated")).resolves.toBe("updated");
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.workspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "workspace" } }));
  });
});
