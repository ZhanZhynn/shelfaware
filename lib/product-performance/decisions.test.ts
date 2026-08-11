import { describe, expect, it } from "vitest";
import { decideProduct } from "./decisions";

const base = { active: true, coverageComplete: true, unitsSold: 30, available: 20, dailyVelocity: 1, leadTimeDays: 30, trend: "stable" as const, reviewQuality: null };
describe("product performance decisions", () => {
  it("restocks below lead time plus safety, with a transparent quantity", () => expect(decideProduct(base)).toMatchObject({ recommendation: "restock", suggestedQuantity: 17 }));
  it("distinguishes known zero sales with stock from no stock, inactive, and incomplete new-listing coverage", () => {
    expect(decideProduct({ ...base, unitsSold: 0, dailyVelocity: 0, available: 10, leadTimeDays: null })).toMatchObject({ recommendation: "review-excess" });
    expect(decideProduct({ ...base, unitsSold: 0, dailyVelocity: 0, available: 0, leadTimeDays: null })).toMatchObject({ recommendation: "healthy" });
    expect(decideProduct({ ...base, active: false })).toMatchObject({ recommendation: "needs-data" });
    expect(decideProduct({ ...base, coverageComplete: false })).toMatchObject({ recommendation: "needs-data" });
    expect(decideProduct({ ...base, coverageComplete: false, unitsSold: 0, dailyVelocity: 0, available: 10 })).toMatchObject({ recommendation: "needs-data", reasons: ["incomplete-observation-coverage"] });
  });
  it("uses listing signals without a conversion proxy and respects precedence", () => {
    expect(decideProduct({ ...base, available: 200, leadTimeDays: 14, trend: "decreasing" })).toMatchObject({ recommendation: "review-excess" });
    expect(decideProduct({ ...base, available: 50, leadTimeDays: 14, trend: "decreasing" })).toMatchObject({ recommendation: "review-listing" });
  });
});
