import { describe, expect, it } from "vitest";
import { resolveLazadaFinanceLine } from "./finance-attribution";

const known = (shop: string, order: string, line: string) => shop === "shop-1" && order === "order-1" && line === "1001";
describe("Lazada financial line references", () => {
  it("uses a transaction number or provider reference only when it matches a known line in the same order and shop", () => {
    expect(resolveLazadaFinanceLine("shop-1", "order-1", { sourceTransactionNumber: "1001" }, known)).toEqual({ externalLineId: "1001", basis: "provider_transaction_number" });
    expect(resolveLazadaFinanceLine("shop-1", "order-1", { rawPayload: { reference: 1001 } }, known)).toEqual({ externalLineId: "1001", basis: "provider_reference" });
    expect(resolveLazadaFinanceLine("shop-1", "order-1", { itemExternalId: "1001", sourceTransactionNumber: "different" }, known).basis).toBe("provider_orderItem_no");
    expect(resolveLazadaFinanceLine("other-shop", "order-1", { sourceTransactionNumber: "1001" }, known).externalLineId).toBeNull();
    expect(resolveLazadaFinanceLine("shop-1", "other-order", { sourceTransactionNumber: "1001" }, known).externalLineId).toBeNull();
    expect(resolveLazadaFinanceLine("shop-1", null, { sourceTransactionNumber: "1001" }, known).externalLineId).toBeNull();
  });
});
