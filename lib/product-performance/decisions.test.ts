import { describe, expect, it } from "vitest";
import { decideProduct } from "./decisions";

const base = {
  active: true,
  coverageComplete: true,
  totalUnitsSold: 30,
  available: 20,
  inboundQuantity: 0,
  dailyVelocity: 1,
  leadTimeDays: 30,
  projectedStockoutDate: new Date("2026-01-21"),
  willStockOutWithinLeadTime: true,
  trend: "stable" as const,
};

describe("product performance decisions", () => {
  it("marks stock that cannot cover lead time as critical", () => {
    expect(decideProduct(base)).toMatchObject({ recommendation: "critical", suggestedQuantity: 17, reasons: ["stockout-before-replenishment"] });
  });

  it("uses inbound stock in the reorder calculation", () => {
    expect(decideProduct({ ...base, available: 35, inboundQuantity: 1, projectedStockoutDate: new Date("2026-02-05"), willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "reorder", suggestedQuantity: 1 });
    expect(decideProduct({ ...base, inboundQuantity: 20, willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "watch", suggestedQuantity: 0 });
  });

  it("distinguishes dormant, not-stocked, inactive, and data issues", () => {
    expect(decideProduct({ ...base, totalUnitsSold: 0, dailyVelocity: 0, available: 10, leadTimeDays: null, projectedStockoutDate: null, willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "dormant" });
    expect(decideProduct({ ...base, totalUnitsSold: 0, dailyVelocity: 0, available: 0, leadTimeDays: null, projectedStockoutDate: null, willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "not-stocked" });
    expect(decideProduct({ ...base, active: false })).toMatchObject({ recommendation: "inactive" });
    expect(decideProduct({ ...base, coverageComplete: false })).toMatchObject({ recommendation: "data-issue", reasons: ["incomplete-observation-coverage"] });
  });

  it("separates excess and growing-demand watch signals", () => {
    expect(decideProduct({ ...base, available: 200, leadTimeDays: 14, projectedStockoutDate: new Date("2026-07-20"), willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "excess" });
    expect(decideProduct({ ...base, available: 25, leadTimeDays: 14, trend: "increasing", projectedStockoutDate: new Date("2026-01-26"), willStockOutWithinLeadTime: false })).toMatchObject({ recommendation: "watch" });
  });
});
