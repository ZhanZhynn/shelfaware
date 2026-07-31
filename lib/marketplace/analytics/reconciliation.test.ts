import { describe, expect, it } from "vitest";
import { marketplaceMaturityDate, reconcileMarketplaceFinancialRecords, sumFixedPointRecords } from "./reconciliation";

const record = (overrides: Partial<{ amountMinor: bigint | string; amountScale: number; currency: string | null }> = {}) => ({ amountMinor: 100n, amountScale: 2, currency: "MYR", ...overrides });
const finalStatement = (overrides: Partial<{ amountMinor: bigint | string; amountScale: number; currency: string | null; final: boolean }> = {}) => ({ ...record(overrides), final: true, ...overrides });

describe("marketplace reconciliation", () => {
  it("calculates a 30-day UTC maturity date without mutating the completion date", () => {
    const completedAt = new Date("2026-01-31T12:00:00.000Z");

    expect(marketplaceMaturityDate(completedAt).toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(completedAt.toISOString()).toBe("2026-01-31T12:00:00.000Z");
  });

  it("sums integer minor amounts only for a shared currency and scale", () => {
    expect(sumFixedPointRecords([record({ amountMinor: "100" }), record({ amountMinor: -25n })])).toEqual({ ok: true, total: { amountMinor: 75n, amountScale: 2, currency: "MYR" } });
    expect(sumFixedPointRecords([record(), record({ currency: "SGD" })])).toEqual({ ok: false, reason: "mixed_currency" });
    expect(sumFixedPointRecords([record(), record({ amountScale: 3 })])).toEqual({ ok: false, reason: "mixed_scale" });
  });

  it("remains provisional after maturity without an explicitly final provider statement", () => {
    const result = reconcileMarketplaceFinancialRecords({ completionDate: new Date("2026-01-01T00:00:00.000Z"), records: [record()], now: new Date("2026-02-01T00:00:00.000Z") });

    expect(result).toMatchObject({ status: "provisional", isMature: true, approvalEligible: false, reason: "final_statement_required" });
    expect(reconcileMarketplaceFinancialRecords({ completionDate: new Date("2026-01-01T00:00:00.000Z"), records: [record()], finalStatement: finalStatement({ final: false }), now: new Date("2026-02-01T00:00:00.000Z") })).toMatchObject({ status: "provisional", approvalEligible: false, reason: "final_statement_required" });
  });

  it("accepts exact and one-minor-unit final-statement deltas only after maturity", () => {
    const input = { completionDate: new Date("2026-01-01T00:00:00.000Z"), records: [record({ amountMinor: 75n }), record({ amountMinor: 25n })], now: new Date("2026-02-01T00:00:00.000Z") };

    expect(reconcileMarketplaceFinancialRecords({ ...input, finalStatement: finalStatement({ amountMinor: 100n }) })).toMatchObject({ status: "mature", approvalEligible: true, deltaMinor: 0n, comparison: "exact" });
    expect(reconcileMarketplaceFinancialRecords({ ...input, finalStatement: finalStatement({ amountMinor: 101n }) })).toMatchObject({ status: "mature", approvalEligible: true, deltaMinor: 1n, comparison: "within_one_minor_unit" });
  });

  it("does not allow a matching final statement to approve before the maturity date", () => {
    const result = reconcileMarketplaceFinancialRecords({ completionDate: new Date("2026-01-01T00:00:00.000Z"), records: [record()], finalStatement: finalStatement(), now: new Date("2026-01-30T23:59:59.999Z") });

    expect(result).toMatchObject({ status: "provisional", approvalEligible: false, comparison: "exact", reason: "not_mature" });
  });

  it("marks incompatible or out-of-tolerance evidence unmatched", () => {
    const input = { completionDate: new Date("2026-01-01T00:00:00.000Z"), records: [record()], now: new Date("2026-02-01T00:00:00.000Z") };

    expect(reconcileMarketplaceFinancialRecords({ ...input, finalStatement: finalStatement({ amountMinor: 102n }) })).toMatchObject({ status: "unmatched", approvalEligible: false, comparison: "outside_tolerance", reason: "outside_tolerance" });
    expect(reconcileMarketplaceFinancialRecords({ ...input, finalStatement: finalStatement({ currency: "SGD" }) })).toMatchObject({ status: "unmatched", approvalEligible: false, reason: "incompatible_statement" });
  });
});
