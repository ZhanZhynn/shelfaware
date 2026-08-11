import type { ProductRecommendation } from "@/types/product-performance";

export const DEFAULT_SAFETY_DAYS = 7;

export type DecisionInput = {
  active: boolean; coverageComplete: boolean; unitsSold: number; available: number;
  dailyVelocity: number | null; leadTimeDays: number | null; safetyDays?: number;
  trend: "increasing" | "decreasing" | "stable" | null;
  reviewQuality: { count: number; averageRating: number } | null;
};

export function decideProduct(input: DecisionInput): { recommendation: ProductRecommendation; reasons: string[]; suggestedQuantity: number | null } {
  const reasons: string[] = [];
  if (!input.active) return { recommendation: "needs-data", reasons: ["inactive-product"], suggestedQuantity: null };
  if (!input.coverageComplete) return { recommendation: "needs-data", reasons: ["incomplete-observation-coverage"], suggestedQuantity: null };
  const safetyDays = input.safetyDays ?? DEFAULT_SAFETY_DAYS;
  const hasDemand = input.dailyVelocity !== null && input.dailyVelocity > 0;
  if (hasDemand && input.leadTimeDays === null) {
    return { recommendation: "needs-data", reasons: ["supplier-lead-time-unavailable"], suggestedQuantity: null };
  }
  const canRestock = hasDemand && input.leadTimeDays !== null;
  if (canRestock) {
    const leadTimeDays = input.leadTimeDays as number;
    const velocity = input.dailyVelocity as number;
    const targetDays = leadTimeDays + safetyDays;
    if (input.available < velocity * targetDays) {
      reasons.push("stock-below-lead-time-plus-safety");
      return { recommendation: "restock", reasons, suggestedQuantity: Math.max(0, Math.ceil(velocity * targetDays - input.available)) };
    }
  }
  // A known zero is actionable only while active inventory is actually held.
  if (input.available > 0 && input.unitsSold === 0) {
    return { recommendation: "review-excess", reasons: ["zero-sales-with-stock"], suggestedQuantity: null };
  }
  if (input.available > 0 && hasDemand && input.available / (input.dailyVelocity as number) > 90) {
    return { recommendation: "review-excess", reasons: ["more-than-90-days-cover"], suggestedQuantity: null };
  }
  if (input.trend === "decreasing") reasons.push("declining-wms-sales");
  if (input.reviewQuality && input.reviewQuality.count >= 3 && input.reviewQuality.averageRating < 3.5) reasons.push("approved-review-quality-signal");
  if (reasons.length) return { recommendation: "review-listing", reasons, suggestedQuantity: null };
  return { recommendation: "healthy", reasons: ["no-action-signal"], suggestedQuantity: null };
}
