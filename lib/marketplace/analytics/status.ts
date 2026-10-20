import type { MarketplacePlatform } from "./types";
import { normalizeLazadaStatus } from "@/lib/lazada/status";

export type CanonicalOrderStatus = "pending" | "fulfilled" | "completed" | "cancelled" | "returned" | "unknown";
export type CanonicalPaymentState = "unpaid" | "paid" | "partially_refunded" | "refunded" | "chargeback" | "unknown";

export interface CanonicalStatus {
  lifecycle: CanonicalOrderStatus;
  payment: CanonicalPaymentState;
  certifiedFinanciallyEligible: boolean;
}

const statusRegistry: Record<MarketplacePlatform, Record<string, CanonicalStatus>> = {
  shopee: {
    UNPAID: { lifecycle: "pending", payment: "unpaid", certifiedFinanciallyEligible: false },
    READY_TO_SHIP: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true },
    PROCESSED: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true },
    SHIPPED: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true },
    COMPLETED: { lifecycle: "completed", payment: "paid", certifiedFinanciallyEligible: true },
    CANCELLED: { lifecycle: "cancelled", payment: "unpaid", certifiedFinanciallyEligible: false },
  },
  lazada: {
    pending: { lifecycle: "pending", payment: "unknown", certifiedFinanciallyEligible: false }, confirmed: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, processing: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, shipped: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, delivered: { lifecycle: "completed", payment: "paid", certifiedFinanciallyEligible: true }, cancelled: { lifecycle: "cancelled", payment: "unpaid", certifiedFinanciallyEligible: false },
    returned: { lifecycle: "returned", payment: "unknown", certifiedFinanciallyEligible: false },
    failed: { lifecycle: "cancelled", payment: "unknown", certifiedFinanciallyEligible: false },
  },
  tiktok: {
    pending: { lifecycle: "pending", payment: "unpaid", certifiedFinanciallyEligible: false }, confirmed: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, processing: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, shipped: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, delivered: { lifecycle: "completed", payment: "paid", certifiedFinanciallyEligible: true }, cancelled: { lifecycle: "cancelled", payment: "unpaid", certifiedFinanciallyEligible: false },
  },
  shopify: {
    open: { lifecycle: "pending", payment: "unknown", certifiedFinanciallyEligible: false }, fulfilled: { lifecycle: "fulfilled", payment: "paid", certifiedFinanciallyEligible: true }, closed: { lifecycle: "completed", payment: "paid", certifiedFinanciallyEligible: true }, cancelled: { lifecycle: "cancelled", payment: "unpaid", certifiedFinanciallyEligible: false }, refunded: { lifecycle: "returned", payment: "refunded", certifiedFinanciallyEligible: false },
  },
};

export function canonicalizeStatus(platform: MarketplacePlatform, rawStatus: string): CanonicalStatus {
  const normalized = platform === "lazada" ? normalizeLazadaStatus(rawStatus) : rawStatus.toLowerCase();
  return statusRegistry[platform][rawStatus] ?? statusRegistry[platform][normalized] ?? { lifecycle: "unknown", payment: "unknown", certifiedFinanciallyEligible: false };
}
