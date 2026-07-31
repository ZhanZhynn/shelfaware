import { describe, expect, it } from "vitest";
import { calculateBuyerMetrics, calculateClvMetrics, calculateProfit } from "./calculators";
import { parseSourceNumber } from "./provenance";

const order = (overrides: Partial<Parameters<typeof calculateProfit>[0][number]> = {}) => ({ id: "1", shopId: "s", platform: "shopee" as const, currency: "MYR", createdAt: new Date("2026-01-01"), status: "COMPLETED", buyerId: null, buyerDisplayName: null, financialQuality: "verified" as const, grossSales: 100, sellerDiscount: 0, platformDiscount: null, refund: 0, buyerShippingCredit: 0, platformSubsidy: 0, marketplaceFees: 0, paymentFees: 0, sellerShipping: 0, returnShipping: 0, otherCharges: 0, settledProceeds: null, settledProceedsVerified: false, items: [], ...overrides });

describe("calculateProfit", () => {
  it("keeps legacy, unknown-status, and TikTok default financial data unavailable", () => {
    const result = calculateProfit([order({ platform: "tiktok", status: "NOT_OBSERVED", financialQuality: "legacy-unverified", grossSales: 0, refund: 0 })], "MYR");
    expect(result.grossSales).toBeNull();
    expect(result.refunds).toBeNull();
    expect(result.coverage.state).toBe("unavailable");
  });
  it("keeps unavailable costs unknown and excludes tax", () => {
    const result = calculateProfit([order({ sellerDiscount: 10, platformDiscount: 20, refund: 5, platformSubsidy: 2, marketplaceFees: 8, paymentFees: null, sellerShipping: 4, returnShipping: null, otherCharges: null })], "MYR");
    expect(result.netSales).toBe(85);
    expect(result.estimatedProfit).toBeNull();
    expect(result.coverage.calculationBasis).toBe("partial");
    expect(result.coverage.missingCostCategories).toContain("payment and transaction fees");
  });

  it("does not treat a default seller income as a verified settlement", () => {
    const result = calculateProfit([order({ settledProceeds: 0, settledProceedsVerified: false })], "MYR");
    expect(result.coverage.calculationBasis).toBe("order-estimate");
    expect(result.estimatedProfit).toBe(100);
  });

  it("uses verified settlement proceeds only when every included order is verified", () => {
    const result = calculateProfit([order({ settledProceeds: 70, settledProceedsVerified: true })], "MYR");
    expect(result.coverage.calculationBasis).toBe("settled");
    expect(result.estimatedProfit).toBe(70);
  });
});

describe("source number parsing", () => {
  it("distinguishes absent, null, explicit string/numeric zero, malformed, and nonfinite values", () => {
    expect(parseSourceNumber(undefined).value).toBeNull();
    expect(parseSourceNumber(null).value).toBeNull();
    expect(parseSourceNumber("0")).toMatchObject({ value: 0, quality: "unknown", unknownReason: "source_observed_unverified" });
    expect(parseSourceNumber(0)).toMatchObject({ value: 0, quality: "unknown", unknownReason: "source_observed_unverified" });
    expect(parseSourceNumber("bad").value).toBeNull();
    expect(parseSourceNumber(Infinity).value).toBeNull();
  });
});

describe("calculateClvMetrics", () => {
  it("excludes cancelled orders and accounts for refunds in CLV", () => {
    const result = calculateClvMetrics([
      order({ id: "a", buyerId: "buyer", grossSales: 100, refund: 20, createdAt: new Date("2026-01-01") }),
      order({ id: "b", buyerId: "buyer", grossSales: 50, createdAt: new Date("2026-04-10") }),
      order({ id: "c", buyerId: "buyer", grossSales: 999, status: "CANCELLED", createdAt: new Date("2026-04-11") }),
    ]);
    expect(result.summary.totalBuyers).toBe(1);
    expect(result.topBuyersByClv[0]).toMatchObject({ historicalNetSales: 130, orderCount: 2, recencyDays: 0 });
    expect(result.segments.potential).toBe(1);
  });

  it("returns only the supplied non-PII display pseudonym", () => {
    const result = calculateClvMetrics([order({ buyerId: "buyer@example.com", buyerDisplayName: "Buyer 9ea1d4c203" })]);
    expect(result.topBuyersByClv[0]?.displayName).toBe("Buyer 9ea1d4c203");
    expect(JSON.stringify(result)).not.toContain("buyer@example.com");
  });
});

describe("calculateBuyerMetrics", () => {
  it("retains operational buyer counts when finance provenance is unavailable", () => {
    const result = calculateBuyerMetrics([order({ id: "a", buyerId: "buyer", financialQuality: "legacy-unverified" }), order({ id: "b", buyerId: "buyer", financialQuality: "legacy-unverified" })]);
    expect(result).toMatchObject({ uniqueBuyers: 1, repeatBuyers: 1, repeatPurchaseRate: 100, averageOrderValue: null, availabilityReason: "buyer_value_unavailable" });
    expect(result.topBuyers[0]).toMatchObject({ orders: 2, historicalNetSales: null });
  });

  it("marks buyer activity unavailable when eligible orders lack buyer identity", () => {
    const result = calculateBuyerMetrics([order({ buyerId: null, financialQuality: "legacy-unverified" })]);
    expect(result).toMatchObject({ uniqueBuyers: null, repeatBuyers: null, repeatPurchaseRate: null, availabilityReason: "buyer_identity_unavailable" });
  });

  it("preserves a verified empty operational dataset as zero buyers", () => {
    expect(calculateBuyerMetrics([])).toMatchObject({ uniqueBuyers: 0, repeatBuyers: 0, repeatPurchaseRate: 0, availabilityReason: null });
  });
});
