import { describe, expect, it } from "vitest";
import {
  sourcingCaseSchema,
  sourcingCommandSchema,
  sourcingQuoteSchema,
} from "@/lib/validations/sourcing";
import { canEditQuote, nextQuoteRevision } from "./workflow";

describe("sourcing workflow semantics", () => {
  it("keeps an active draft revision and increments after submission", () => {
    expect(nextQuoteRevision({ revision: 2, status: "draft" })).toBe(2);
    expect(nextQuoteRevision({ revision: 2, status: "submitted" })).toBe(3);
  });
  it("allows only an assigned sourcer to edit an active-stage quote", () => {
    expect(canEditQuote("sourcer", false, "me", "me", "sourcing")).toBe(true);
    expect(canEditQuote("sourcer", false, "other", "me", "sourcing")).toBe(
      false,
    );
    expect(canEditQuote("sourcer", false, "me", "me", "quoted")).toBe(false);
  });
  it("validates one-product request and structured RMB quote input", () => {
    expect(
      sourcingCaseSchema.safeParse({
        workspaceId: "w",
        title: "",
        route: "yiwu",
      }).success,
    ).toBe(false);
    expect(
      sourcingQuoteSchema.safeParse({
        supplierName: "Yiwu Co",
        unitPriceRmb: "12.5",
        moq: "20",
      }).success,
    ).toBe(true);
    const optionalFields = sourcingQuoteSchema.parse({
      supplierName: "Yiwu Co",
      unitPriceRmb: "12.5",
      moq: "",
      unitsPerCarton: "",
      cartonWeightKg: "",
      leadTimeDays: "",
      validUntil: "",
    });
    expect(optionalFields).toMatchObject({
      moq: undefined,
      unitsPerCarton: undefined,
      cartonWeightKg: undefined,
      leadTimeDays: undefined,
      validUntil: undefined,
    });
    expect(
      sourcingQuoteSchema.safeParse({
        supplierName: "Yiwu Co",
        unitPriceRmb: 1,
        moq: 0,
      }).success,
    ).toBe(false);
    expect(
      sourcingCaseSchema.safeParse({
        workspaceId: "w",
        title: "Case",
        referenceUrl: "ftp://example.com",
      }).success,
    ).toBe(false);
    expect(
      sourcingCaseSchema.safeParse({
        workspaceId: "w",
        title: "Case",
        photoUrls: ["ftp://example.com"],
      }).success,
    ).toBe(false);
    expect(
      sourcingQuoteSchema.safeParse({
        supplierName: "Yiwu Co",
        unitPriceRmb: 1,
        samplePhotoUrls: ["javascript:alert(1)"],
      }).success,
    ).toBe(false);
    expect(
      sourcingCaseSchema.parse({
        workspaceId: "w",
        title: "Case",
        referenceUrl: "",
      }).referenceUrl,
    ).toBeUndefined();
    expect(
      sourcingCommandSchema.safeParse({ action: "reject", version: 1 }).success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "cannot_source",
        version: 1,
        reason: "Supplier unavailable",
      }).success,
    ).toBe(true);
  });
});
