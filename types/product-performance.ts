export type ProductRecommendation = "inactive" | "critical" | "reorder" | "watch" | "healthy" | "excess" | "dormant" | "not-stocked" | "data-issue";
export type ProductTier = "A" | "B" | "C" | null;
export type DemandPerformance = "growing" | "stable" | "declining" | "no-demand" | "insufficient-data";

export type MarketplaceRevenueEntry = { minor: number; scale: number };

export type ContributingSalesSku = {
  id: string;
  code: string;
  name: string;
  isKit: boolean;
  normalizedUnits: number;
  marketplaceUnits: number | null;
  unitsPerSale: number | null;
  componentSupportedQuantity: number | null;
  channels: string[];
};

export type MarketplaceCoverage = { observedOffers: number; linkedOffers: number; activityPercent: number };
export type ChannelDemand = { normalizedUnits: number; marketplaceUnits: number };
export type MarketplaceAttribution = { rawShopeeOrderItems: number; normalizedComponentFacts: number; state: "no-shopee-sales" | "unprojected" | "partial" };

export type ProductPerformanceRow = {
  id: string; name: string; sku: string; category: string | null; tier: ProductTier;
  revenue: number; unitsSold: number; onHand: number; reserved: number; available: number;
  totalNormalizedUnits: number; wmsDailyVelocity: number | null; marketplaceDailyVelocity: number | null;
  dailyVelocity: number | null; daysOfCover: number | null; inventoryPositionDaysOfCover: number | null;
  trend: "increasing" | "decreasing" | "stable" | null; demandPerformance: DemandPerformance; commercialSignals: string[];
  stockStatus: "in-stock" | "out-of-stock" | "reserved-out"; supplierLeadTimeDays: number | null;
  inboundQuantity: number; inventoryPosition: number; nextInboundDate: string | null;
  targetCoverDays: number | null; projectedStockoutDate: string | null; reorderByDate: string | null;
  recommendation: ProductRecommendation; reasons: string[];
  confidence: "high" | "medium" | "needs-data"; confidenceReasons: string[]; coverage: string; suggestedQuantity: number | null;
  reviewQuality: { count: number; averageRating: number } | null;
  marketplaceNormalizedUnits: number | null;
  marketplaceRevenue: Record<string, MarketplaceRevenueEntry> | null;
  marketplaceCoverage: MarketplaceCoverage | null;
  channelDemand: Record<string, ChannelDemand> | null;
  contributingSalesSkus: ContributingSalesSku[] | null;
};

export type ProductPerformanceData = {
  period: { from: string; to: string; days: number }; defaults: { safetyDays: number; maxCoverDays: number };
  products: ProductPerformanceRow[];
  summary: Record<ProductRecommendation, number> & { action: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  attribution: MarketplaceAttribution;
};
