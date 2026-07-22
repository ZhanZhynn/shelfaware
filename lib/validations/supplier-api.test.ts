import { describe, expect, it } from "vitest";
import {
  createSupplierBodySchema,
  updateSupplierBodySchema,
} from "./supplier";

describe("createSupplierBodySchema", () => {
  it("accepts a valid payload", () => {
    const result = createSupplierBodySchema.safeParse({ name: "Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createSupplierBodySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a workspace scope", () => {
    expect(createSupplierBodySchema.safeParse({ name: "Acme Corp", workspaceId: "507f1f77bcf86cd799439011" }).success).toBe(true);
  });
});

describe("updateSupplierBodySchema", () => {
  it("requires id", () => {
    const result = updateSupplierBodySchema.safeParse({ name: "Updated" });
    expect(result.success).toBe(false);
  });

  it("accepts valid update", () => {
    const result = updateSupplierBodySchema.safeParse({
      id: "507f1f77bcf86cd799439011",
      name: "Updated Supplier",
    });
    expect(result.success).toBe(true);
  });
});
