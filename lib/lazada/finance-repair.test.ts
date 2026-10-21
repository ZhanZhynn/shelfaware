import { describe, expect, it } from "vitest";
import { lazadaFinanceIdentity } from "./finance-identity";
import { lazadaFinanceAuditPayload, planLazadaFinanceWrite, type StoredLazadaFinanceRow } from "./finance-repair";

const source = { transaction_number: "provider-line", fee_type: "239", fee_name: "Sponsored Affiliates", order_no: "order-1", orderItem_no: null, amount: "-0.64" };
const identity = lazadaFinanceIdentity(source);
const stored = (id: string, externalId: string, overrides: Partial<StoredLazadaFinanceRow> = {}): StoredLazadaFinanceRow => ({
  id, externalId, shopId: "shop-1", feeType: "239", feeName: "Sponsored Affiliates", orderExternalId: "order-1", orderInternalId: "internal-order", itemExternalId: null,
  amountMinor: "-64", amountScale: 2, currency: null, occurredAt: new Date("2026-08-01T16:00:00Z"), statementExternalId: "statement-period",
  financialQuality: "unknown", updatedAt: new Date("2026-10-20T00:00:00Z"), sourceObservedAt: new Date("2026-10-20T00:00:00Z"), rawPayload: source, ...overrides,
});

describe("Lazada finance alias repair", () => {
  it("does not let an unrelated raw-ID credit shadow the matching v2 affiliate alias", () => {
    const credit = stored("credit-id", identity.transactionNumber, { feeType: "13", feeName: "Item Price Credit", rawPayload: { ...source, fee_type: "13", fee_name: "Item Price Credit" } });
    const old = stored("old-id", identity.legacyExternalId);
    const current = stored("current-id", identity.externalId);
    const plan = planLazadaFinanceWrite("shop-1", source, current, [credit, old]);
    expect(plan.keeper?.id).toBe("current-id");
    expect(plan.duplicates.map((row) => row.id)).toEqual(["old-id"]);
    expect(credit.feeType).toBe("13");
  });

  it("renames a matching legacy observation in place when no current record exists", () => {
    const old = stored("old-id", identity.legacyExternalId);
    const plan = planLazadaFinanceWrite("shop-1", source, null, [old]);
    expect(plan).toMatchObject({ keeper: { id: "old-id" }, duplicates: [], migrated: true });
  });

  it("consolidates two matching legacy aliases into one deterministic canonical write", () => {
    const raw = stored("a-raw", identity.transactionNumber);
    const v2 = stored("b-v2", identity.legacyExternalId);
    const plan = planLazadaFinanceWrite("shop-1", source, null, [v2, raw]);
    expect(plan).toMatchObject({ keeper: { id: "a-raw" }, duplicates: [{ id: "b-v2" }], migrated: true, externalId: identity.externalId });
  });

  it("preserves a distinct fee credit even when it shares the v2 tuple with a charge", () => {
    const refund = stored("refund", identity.legacyExternalId, { feeName: "Sponsored Affiliates Refund", amountMinor: "64", rawPayload: { ...source, fee_name: "Sponsored Affiliates Refund" } });
    const current = stored("charge", identity.externalId);
    expect(planLazadaFinanceWrite("shop-1", source, current, [refund]).duplicates).toEqual([]);
  });

  it("refuses to consolidate different amounts, unknown amounts, different dates/currencies, or certified evidence", () => {
    const current = stored("current-id", identity.externalId);
    for (const change of [{ amountMinor: "-65" }, { amountMinor: null }, { occurredAt: new Date("2026-08-02T16:00:00Z") }, { currency: "USD" }, { financialQuality: "verified" }]) {
      expect(() => planLazadaFinanceWrite("shop-1", source, current, [stored("old-id", identity.legacyExternalId, change)])).toThrow("INCONSISTENT_FINANCE_ALIAS_FACTS");
    }
    expect(() => planLazadaFinanceWrite("shop-1", source, current, [stored("foreign", identity.legacyExternalId, { shopId: "other-shop" })])).toThrow("INCONSISTENT_FINANCE_SCOPE");
  });

  it("compares exact fixed-point values across scales and ignores separately enriched item attribution", () => {
    const current = stored("current", identity.externalId, { itemExternalId: "provider-line" });
    const old = stored("old", identity.legacyExternalId, { amountMinor: "-640", amountScale: 3 });
    expect(planLazadaFinanceWrite("shop-1", source, current, [old]).duplicates).toHaveLength(1);
  });

  it("retains the superseded observation's audit through subsequent imports without retaining sensitive fields", () => {
    const current = stored("current", identity.externalId);
    const old = stored("old", identity.legacyExternalId, { rawPayload: { ...source, access_token: "private-value" } });
    const payload = lazadaFinanceAuditPayload(source, current, [old]);
    expect(payload).toMatchObject({ shelfaware_alias_merges: [{ id: "old", externalId: identity.legacyExternalId, amountMinor: "-64" }] });
    expect(JSON.stringify(payload)).not.toContain("private-value");
    expect(lazadaFinanceAuditPayload(source, { ...current, rawPayload: payload }, [])).toEqual(payload);
  });
});
