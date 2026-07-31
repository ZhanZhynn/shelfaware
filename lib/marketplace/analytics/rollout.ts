import type { CapabilityState } from "./capabilities";

/** Opt-in only. This controls presentation, never financial calculation access. */
export function marketplaceFinancialDisplayEligible(input: { platform: string; region: string | null; shopId: string; enabled?: boolean; finance: CapabilityState; reconciliationApproved: boolean }) {
  const configured = new Set((process.env.MARKETPLACE_FINANCIAL_ROLLOUT_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  // Exact platform/region/internal-shop entries prevent broad accidental rollout.
  return input.enabled === true && configured.has(`${input.platform}:${input.region ?? "none"}:${input.shopId}`) && input.finance === "available" && input.reconciliationApproved;
}
