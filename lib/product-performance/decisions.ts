import type { ProductRecommendation } from "@/types/product-performance";

export const DEFAULT_SAFETY_DAYS = 7;
export const DEFAULT_MAX_COVER_DAYS = 90;

export type DecisionInput = {
  active: boolean;
  coverageComplete: boolean;
  totalUnitsSold: number;
  available: number;
  inboundQuantity: number;
  dailyVelocity: number | null;
  leadTimeDays: number | null;
  safetyDays?: number;
  maxCoverDays?: number;
  projectedStockoutDate: Date | null;
  willStockOutWithinLeadTime: boolean;
  trend: "increasing" | "decreasing" | "stable" | null;
};

export function decideProduct(input: DecisionInput): { recommendation: ProductRecommendation; reasons: string[]; suggestedQuantity: number | null } {
  if (!input.active) return { recommendation: "inactive", reasons: ["inactive-product"], suggestedQuantity: null };
  if (!input.coverageComplete) return { recommendation: "data-issue", reasons: ["incomplete-observation-coverage"], suggestedQuantity: null };

  const safetyDays = input.safetyDays ?? DEFAULT_SAFETY_DAYS;
  const maxCoverDays = input.maxCoverDays ?? DEFAULT_MAX_COVER_DAYS;
  const hasDemand = input.dailyVelocity !== null && input.dailyVelocity > 0;
  const inventoryPosition = input.available + input.inboundQuantity;

  if (hasDemand && input.available <= 0) {
    const targetDays = input.leadTimeDays === null ? safetyDays : input.leadTimeDays + safetyDays;
    return {
      recommendation: "critical",
      reasons: ["out-of-stock-with-demand"],
      suggestedQuantity: Math.max(0, Math.ceil((input.dailyVelocity as number) * targetDays - input.inboundQuantity)),
    };
  }
  if (hasDemand && input.leadTimeDays === null) {
    return { recommendation: "data-issue", reasons: ["supplier-lead-time-unavailable"], suggestedQuantity: null };
  }
  if (hasDemand && input.leadTimeDays !== null) {
    const velocity = input.dailyVelocity as number;
    const targetDays = input.leadTimeDays + safetyDays;
    const targetStock = velocity * targetDays;
    if (input.willStockOutWithinLeadTime) {
      return {
        recommendation: "critical",
        reasons: ["stockout-before-replenishment"],
        suggestedQuantity: Math.max(0, Math.ceil(targetStock - inventoryPosition)),
      };
    }
    if (inventoryPosition < targetStock) {
      return {
        recommendation: "reorder",
        reasons: ["inventory-position-below-reorder-point"],
        suggestedQuantity: Math.max(0, Math.ceil(targetStock - inventoryPosition)),
      };
    }
    if (input.available < targetStock) {
      return { recommendation: "watch", reasons: ["inbound-covers-current-shortfall"], suggestedQuantity: 0 };
    }
  }
  if (input.available > 0 && input.totalUnitsSold === 0) {
    return { recommendation: "dormant", reasons: ["zero-sales-with-stock"], suggestedQuantity: null };
  }
  if (!hasDemand && input.available <= 0) {
    return { recommendation: "not-stocked", reasons: ["no-demand-and-no-stock"], suggestedQuantity: null };
  }
  if (input.available > 0 && hasDemand && input.available / (input.dailyVelocity as number) > maxCoverDays) {
    return { recommendation: "excess", reasons: ["stock-above-maximum-cover"], suggestedQuantity: null };
  }
  if (hasDemand && input.trend === "increasing" && input.leadTimeDays !== null && input.available / (input.dailyVelocity as number) <= input.leadTimeDays + safetyDays * 2) {
    return { recommendation: "watch", reasons: ["demand-growing-near-reorder-window"], suggestedQuantity: null };
  }
  return { recommendation: "healthy", reasons: ["inventory-within-policy"], suggestedQuantity: null };
}
