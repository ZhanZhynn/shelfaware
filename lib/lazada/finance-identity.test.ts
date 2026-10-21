import { describe, expect, it } from "vitest";
import { lazadaFinanceIdentity, lazadaFinanceLegacyIdentity, lazadaFinanceSameComponent } from "./finance-identity";

describe("Lazada fee-component identity", () => {
  const source = { transaction_number: "provider-group", fee_type: "13", order_no: "order", orderItem_no: "line", amount: "20.00" };
  it("namespaces a shared transaction number by fee type and line", () => {
    expect(lazadaFinanceIdentity(source).externalId).not.toBe(lazadaFinanceIdentity({ ...source, fee_type: "14" }).externalId);
    expect(lazadaFinanceIdentity(source).externalId).not.toBe(lazadaFinanceIdentity({ ...source, orderItem_no: "other-line" }).externalId);
    expect(lazadaFinanceIdentity(source).externalId).not.toBe(lazadaFinanceIdentity({ ...source, fee_name: "Different component" }).externalId);
  });
  it("does not create another posting identity when money, dates, or display metadata change", () => {
    expect(lazadaFinanceIdentity(source).externalId).toBe(lazadaFinanceIdentity({ ...source, amount: "19.00", transaction_date: "2026-08-02", paid_status: "Yes" }).externalId);
    expect(lazadaFinanceIdentity({ transaction_number: 123, fee_type: 13, order_no: 10, orderItem_no: 11 }).externalId).toBe(lazadaFinanceIdentity({ transaction_number: "123", fee_type: "13", order_no: "10", orderItem_no: "11" }).externalId);
  });
  it("recognizes the earlier v2 tuple for safe in-place migration while detecting its component limitation", () => {
    const second = { ...source, fee_name: "Commission", amount: "-2.00" };
    expect(lazadaFinanceLegacyIdentity(source)).toBe(lazadaFinanceLegacyIdentity(second));
    expect(lazadaFinanceSameComponent(source, source)).toBe(true);
    expect(lazadaFinanceSameComponent(source, second)).toBe(false);
  });
});
