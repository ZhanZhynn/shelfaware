import { describe, expect, it } from "vitest";
import {
  sourcingCaseSchema,
  sourcingCommandSchema,
  sourcingQuoteSchema,
} from "@/lib/validations/sourcing";
import { canEditQuote, nextQuoteRevision, quoteGroupKey } from "./workflow";

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
    expect(canEditQuote("sourcer", false, "me", "me", "quoted")).toBe(true);
    expect(canEditQuote("admin", false, "me", "me", "changes_requested")).toBe(
      false,
    );
    expect(canEditQuote("admin", true, "me", "me", "changes_requested")).toBe(
      true,
    );
  });
  it("uses a legacy quote ID as its offer group until it is backfilled", () => {
    expect(quoteGroupKey({ id: "legacy", quoteGroupId: null })).toBe("legacy");
    expect(quoteGroupKey({ id: "revision", quoteGroupId: "offer" })).toBe(
      "offer",
    );
  });
  it("validates one-product request and structured RMB quote input", () => {
    expect(
      sourcingCaseSchema.safeParse({
        workspaceId: "w",
        title: "",
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
        requestedQuantity: "25",
        targetUnitPriceMyr: "8.5",
      }).referenceUrl,
    ).toBeUndefined();
    expect(
      sourcingCaseSchema.parse({
        workspaceId: "w",
        title: "Case",
        requestedQuantity: "25",
        targetUnitPriceMyr: "8.5",
      }),
    ).toMatchObject({ requestedQuantity: 25, targetUnitPriceMyr: 8.5 });
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
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve",
        version: 1,
        fxRateOverride: 0.61,
      }).success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({ action: "approve", version: 1 })
        .success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({ action: "withdraw_quote", version: 1 })
        .success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "withdraw_quote",
        version: 1,
        quoteId: "quote-1",
      }).success,
    ).toBe(true);
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve_and_create_order",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve_and_create_order",
        version: 1,
        quoteId: "quote-1",
        orderQuantity: "25",
      }).success,
    ).toBe(true);
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve_and_create_order",
        version: 1,
        quoteId: "quote-1",
        orderQuantity: 1.5,
      }).success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve_and_create_order",
        version: 1,
        quoteId: "quote-1",
        fxRateOverride: 0.61,
      }).success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "approve_and_create_order",
        version: 1,
        quoteId: "quote-1",
        fxRateOverride: 0.61,
        fxOverrideReason: "Supplier invoice rate",
      }).success,
    ).toBe(true);
    expect(
      sourcingCommandSchema.safeParse({ action: "create_quote", version: 1 })
        .success,
    ).toBe(false);
    expect(
      sourcingCommandSchema.safeParse({
        action: "submit_quote",
        version: 1,
        quote: { supplierName: "Yiwu Co", unitPriceRmb: 1 },
      }).success,
    ).toBe(true);
    expect(
      sourcingCommandSchema.safeParse({
        action: "save_quote",
        version: 1,
        quote: { supplierName: "Yiwu Co", unitPriceRmb: 1 },
      }).success,
    ).toBe(true);
  });
});
