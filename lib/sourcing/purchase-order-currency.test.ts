import { describe, expect, it } from "vitest";
import { sourcingPurchaseOrderEstimate } from "./purchase-order-currency";

describe("sourcing purchase-order currency", () => {
  const currentRate = { rate: 0.60433, rateDate: new Date("2026-07-22"), provider: "frankfurter" };

  it("keeps CNY PO totals in CNY and adds a separate current MYR estimate", () => {
    expect(sourcingPurchaseOrderEstimate({ currency: "CNY", totalAmount: 53599 }, currentRate)).toMatchObject({
      currency: "CNY",
      myrEstimate: 32391.48,
      estimateKind: "current",
      estimateRate: 0.60433,
    });
  });

  it("uses the locked approval conversion when available", () => {
    expect(sourcingPurchaseOrderEstimate({ currency: "CNY", totalAmount: 100, convertedTotalMyr: 61, fxRate: 0.61 }, currentRate)).toMatchObject({
      myrEstimate: 61,
      estimateKind: "locked",
      estimateRate: 0.61,
    });
  });
});
