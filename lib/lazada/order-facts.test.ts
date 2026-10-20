import { describe, expect, it } from "vitest";
import { lazadaOrderFacts } from "./order-facts";
import { sumLazadaSourceMoney } from "./money";

describe("Lazada order amount and quantity bases", () => {
  it("separates paid merchandise, shipping, and gross without leaking provider payloads", () => {
    const result = lazadaOrderFacts(57, 4.58, [{ externalLineId: "a", paidPrice: 25, quantity: null }, { externalLineId: "b", paidPrice: 27, quantity: null }], { statuses: ["confirmed"], voucher_seller: "1.00", customer_first_name: "private", address_shipping: { street: "private" } });
    expect(result).toMatchObject({ amountBasis: "gross_merchandise", grossMerchandiseAmount: 57, paidMerchandiseAmount: 52, buyerPaidTotalAmount: 56.58, itemRowCount: 2, unitQuantity: null, sellerDiscountAmount: 1 });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("does not infer a paid amount, zero quantities, or complete totals from missing or duplicate lines", () => {
    expect(lazadaOrderFacts(10, 1, [{ externalLineId: "a", paidPrice: null, quantity: null }], {})).toMatchObject({ paidMerchandiseAmount: null, buyerPaidTotalAmount: null, unitQuantity: null });
    expect(lazadaOrderFacts(10, 1, [{ externalLineId: "a", paidPrice: 2, quantity: 1 }, { externalLineId: "a", paidPrice: 2, quantity: 1 }], {})).toMatchObject({ itemRowCount: null, paidMerchandiseAmount: null, unitQuantity: null });
    expect(sumLazadaSourceMoney([0.1, 0.2])).toBe(0.3);
    expect(sumLazadaSourceMoney([10, null])).toBeNull();
  });
});
