import { describe, expect, it } from "vitest";
import { MarketplaceLiveValidationError, parseLiveQuery } from "./live";

describe("live marketplace query parsing", () => {
  it("requires the canonical internal shop ID and materializes a bounded order window", () => {
    const query = parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), limit: "10" }), "orders");
    expect(query).toMatchObject({ shopId: "a".repeat(24), limit: 10 });
    expect(query.createdAfter).toBeTruthy();
    expect(query.createdBefore).toBeTruthy();
    expect(new Date(query.createdBefore!).getTime() - new Date(query.createdAfter!).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejects provider shop IDs, duplicate filters, and unbounded date ranges", () => {
    expect(() => parseLiveQuery(new URLSearchParams({ shopId: "provider-shop-id" }), "products")).toThrow(MarketplaceLiveValidationError);
    expect(() => parseLiveQuery(new URLSearchParams(`shopId=${"a".repeat(24)}&status=ACTIVE&status=DRAFT`), "products")).toThrow(MarketplaceLiveValidationError);
    expect(() => parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), createdAfter: "2026-01-01T00:00:00.000Z", createdBefore: "2026-02-02T00:00:00.000Z" }), "orders")).toThrow("Date range must not exceed 31 days");
  });
});
