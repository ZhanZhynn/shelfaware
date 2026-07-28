import { describe, expect, it } from "vitest";
import { createUserAdminSchema } from "./user-management";

describe("user management account types", () => {
  const user = {
    email: "admin@example.com",
    name: "Admin",
    password: "secret1",
  };

  it("allows an Admin account without workspace assignments", () => {
    expect(
      createUserAdminSchema.safeParse({
        ...user,
        accountType: "workspace_admin",
      }).success,
    ).toBe(true);
  });

  it("allows a global Sourcer account", () => {
    expect(
      createUserAdminSchema.safeParse({
        ...user,
        accountType: "sourcer",
      }).success,
    ).toBe(true);
  });

  it("allows a Super admin without workspace assignments", () => {
    expect(
      createUserAdminSchema.parse({ ...user, accountType: "super_admin" }),
    ).toMatchObject({ accountType: "super_admin" });
  });
});
