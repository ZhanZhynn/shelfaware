import type { FinancialQuality } from "./provenance";

export type MarketplacePlatform = "shopee" | "lazada" | "tiktok" | "shopify";
export type CalculationBasis = "settled" | "order-estimate" | "partial" | "unavailable";

export interface NormalizedOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  quantity: number | null;
  grossSales: number | null;
  refund: number | null;
  financialQuality: FinancialQuality;
}

export interface NormalizedOrderFinancials {
  id: string; shopId: string; platform: MarketplacePlatform; currency: string; createdAt: Date; status: string;
  buyerId: string | null; buyerDisplayName: string | null; financialQuality: FinancialQuality;
  grossSales: number | null; sellerDiscount: number | null; platformDiscount: number | null; refund: number | null;
  buyerShippingCredit: number | null; platformSubsidy: number | null; marketplaceFees: number | null;
  paymentFees: number | null; sellerShipping: number | null; returnShipping: number | null; otherCharges: number | null;
  settledProceeds: number | null; settledProceedsVerified: boolean; items: NormalizedOrderItem[];
}

export interface AnalyticsCoverage {
  state: "ready" | "partial" | "unavailable";
  calculationBasis: CalculationBasis;
  financialCoveragePercent: number | null;
  buyerIdentityCoveragePercent: number;
  missingCostCategories: string[];
  reportingCurrency: string;
  conversion: { applied: false; sourceCurrencies: string[] };
  exclusions: string[];
  unavailableReasons: string[];
  rawOrderCount: number;
  certifiedOrderCount: number;
}

/** Observed operational facts only. This intentionally says nothing about finance. */
export interface OperationalCoverage {
  state: "ready" | "partial" | "unavailable";
  availability: "available" | "no_data" | "backfilling" | "unsupported" | "not_authorized" | "error";
  reason: string | null;
  observedDateRange: { from: string; to: string } | null;
  rawOrderCount: number;
  rawItemCount: number;
  unknownStatusCount: number;
  unknownQuantityCount: number;
  unknownIdentityCount: number;
  sourceCurrencies: string[];
}

export interface ProfitSummary {
  grossSales: number | null; sellerDiscounts: number | null; refunds: number | null; netSales: number | null;
  buyerShippingCredits: number | null; platformSubsidies: number | null; marketplaceFees: number | null;
  paymentFees: number | null; sellerShipping: number | null; returnShipping: number | null; otherCharges: number | null;
  estimatedProfit: number | null; estimatedMargin: number | null; orderCount: number; coverage: AnalyticsCoverage;
}

export interface BuyerMetrics {
  uniqueBuyers: number | null;
  repeatBuyers: number | null;
  repeatPurchaseRate: number | null;
  averageOrderValue: number | null;
  topBuyers: Array<{ displayName: string | null; orders: number; sales: number | null; historicalNetSales: number | null }>;
  availabilityReason: string | null;
}

export interface ClvMetrics {
  summary: { totalBuyers: number; historicalNetSales: number | null; predictedNetRevenueNext12Months: null; method: null; horizonMonths: null; availabilityReason: string };
  segments: { champions: number; loyal: number; potential: number; atRisk: number; lost: number };
  churnRisk: { high: number; medium: number; low: number };
  topBuyersByClv: Array<{ displayName: string; historicalNetSales: number | null; predictedNetRevenueNext12Months: null; orderCount: number; avgOrderValue: number | null; recencyDays: number; availabilityReason?: string }>;
}
