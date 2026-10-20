import { describe, expect, it } from "vitest";
import { buildLazadaProfitReport, sumLazadaMoney, type LazadaFinancialRow, type LazadaReportOrder } from "./financial-report";

const order = (overrides: Partial<LazadaReportOrder> = {}): LazadaReportOrder => ({
  id: "order-1", shopId: "shop-1", lazadaOrderId: "external-order", orderStatus: "confirmed", currency: "MYR",
  items: [{ id: "line-1", lazadaOrderItemId: 1001, itemId: 1, skuId: "variant-a", sellerSku: "SKU-A", shopSku: null, productName: "Same name", paidPrice: 20, quantity: null }], ...overrides,
});
const row = (feeName: string, amountMinor: string, overrides: Partial<LazadaFinancialRow> = {}): LazadaFinancialRow => ({
  shopId: "shop-1", amountMinor, amountScale: 2, currency: "MYR", feeName, transactionType: "source-type-id", orderExternalId: "external-order", itemExternalId: "1001", financialQuality: "verified", ...overrides,
});

describe("Lazada financial source completeness", () => {
  it("keeps missing money, fees, quantities, and margins unknown instead of reporting zero or 100%", () => {
    const result = buildLazadaProfitReport([], [order()]);
    expect(result.summary).toMatchObject({ totalRevenue: null, totalFees: null, totalShipping: null, sellerIncome: null, overallMargin: null, observedLedgerNet: null });
    expect(result.coverage.state).toBe("unavailable");
    expect(result.coverage.unavailableReasons).toContain("no imported Lazada transaction records");
    expect(result.byProduct[0]).toMatchObject({ revenue: 20, quantitySold: null, estimatedFees: null, estimatedProfit: null, margin: null });
  });

  it("preserves explicit zero and does not invent absent costs in partial history", () => {
    const result = buildLazadaProfitReport([row("Item Price Credit", "0")], [order()]);
    expect(result.summary).toMatchObject({ totalRevenue: 0, totalFees: null, sellerIncome: null, observedLedgerNet: 0 });
    expect(result.coverage.state).toBe("provisional");
  });

  it("reconciles signed source postings and leaves statement-level adjustments unallocated", () => {
    // Aggregate, non-customer fixture covering the 13 observed source categories.
    const records = [
      row("Item Price Credit", "729763"), row("Reversal Item Price", "-3450"),
      row("LazCoins Discount", "-2933"), row("Reversal of LazCoins Discount", "35"),
      row("Commission", "-159394"), row("Reversal Commission", "793"),
      row("Payment Fee", "-30823"), row("Payment Fee Credit", "130"),
      row("LazCoins Discount Promotion Fee", "-4210"), row("Sponsored Affiliates", "-9353"),
      row("Sponsored Affiliates Refund", "3511"), row("Shipping Fee Subsidy (By Seller)", "-636"),
      row("Wrong Weight Adjustment", "-9089", { orderExternalId: null, itemExternalId: null }),
    ];
    const partial = buildLazadaProfitReport(records, [order()]);
    expect(partial.summary).toMatchObject({ totalRevenue: 7297.63, refunds: 34.5, sellerDiscounts: 28.98, observedLedgerNet: 5143.44, sellerIncome: null, unallocatedLedgerNet: -90.89, unallocatedRecordCount: 1 });
    expect(partial.feeBreakdown.find((fee) => fee.name === "Payment Fee Credit")?.amount).toBe(-1.3);
    const ready = buildLazadaProfitReport(records, [order()], true);
    expect(ready.summary.sellerIncome).toBe(5143.44);
    expect(ready.byProduct[0]!.estimatedProfit).toBeNull();
  });

  it("uses line identifiers and shop/variant identity instead of grouping by names or treating line IDs as SKUs", () => {
    const a = order();
    const b = order({ id: "order-2", lazadaOrderId: "external-b", items: [{ ...a.items[0]!, id: "line-2", lazadaOrderItemId: 1002, skuId: "variant-b", sellerSku: "SKU-B", quantity: 1 }] });
    const result = buildLazadaProfitReport([row("Item Price Credit", "2000"), row("Commission", "-200")], [a, b], true);
    expect(result.byProduct).toHaveLength(2);
    expect(result.byProduct.find((product) => product.variantId === "variant-a")).toMatchObject({ quantitySold: null, estimatedFees: 2, estimatedProfit: 18 });
    expect(result.byProduct.find((product) => product.variantId === "variant-b")).toMatchObject({ quantitySold: 1, estimatedFees: null, estimatedProfit: null });
  });

  it("does not discard missing amounts, unmapped fees, currency gaps, or unsafe precision", () => {
    for (const bad of [row("Commission", "0", { amountMinor: null }), row("Unknown fee", "10"), row("Commission", "10", { currency: null })]) {
      const result = buildLazadaProfitReport([row("Item Price Credit", "2000"), bad], [order()], true);
      expect(result.summary.sellerIncome).toBeNull();
      expect(result.coverage.state).not.toBe("ready");
      expect(result.summary.totalRevenue).toBeNull();
    }
    expect(sumLazadaMoney([row("Item Price Credit", "9007199254740993")])).toBeNull();
    expect(sumLazadaMoney([row("Item Price Credit", "10", { amountScale: 1 }), row("Commission", "-25")])).toBe(0.75);
  });

  it("never counts payout or duplicate logistics observations as transaction income", () => {
    const result = buildLazadaProfitReport([row("Item Price Credit", "1000"), row("Wrong Weight Adjustment", "-50", { transactionType: "logistics_fee" }), row("Payout", "1000", { transactionType: "payout_statement" })], [order()]);
    expect(result.summary.observedLedgerNet).toBe(10);
  });
});
