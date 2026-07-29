import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/prisma/client", () => ({
  prisma: { user: { findMany: mocks.findMany } },
}));

import { getAdminDataScope } from "./data-scope";

afterEach(() => {
  mocks.findMany.mockReset();
});

describe("getAdminDataScope", () => {
  it("keeps non-admin users scoped to themselves without querying admin owners", async () => {
    await expect(
      getAdminDataScope({ id: "user-1", role: "client" }),
    ).resolves.toEqual({
      ownerIds: ["user-1"],
      sharedAdmin: false,
      cacheScope: "user:user-1",
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns approved admin owners under the shared cache scope", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "admin-1", status: "approved" },
      { id: "admin-2", status: null },
      { id: "admin-3", status: "pending" },
      { id: "admin-4", status: "rejected" },
    ]);

    await expect(
      getAdminDataScope({ id: "admin-1", role: "admin" }),
    ).resolves.toEqual({
      ownerIds: ["admin-1", "admin-2"],
      sharedAdmin: true,
      cacheScope: "admin-shared",
    });
  });
});
