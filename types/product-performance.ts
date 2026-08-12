export type ProductRecommendation = "needs-data" | "restock" | "review-excess" | "review-listing" | "healthy";
export type ProductTier = "A" | "B" | "C" | null;

export type MarketplaceRevenueEntry = { minor: number; scale: number };

export type ContributingSalesSku = { id: string; code: string; name: string; units: number };

export type MarketplaceCoverage = { mappedOffers: number; totalOffers: number; mappingPercent: number };

export type ProductPerformanceRow = {
  id: string; name: string; sku: string; category: string | null; tier: ProductTier;
  revenue: number; unitsSold: number; onHand: number; reserved: number; available: number;
  dailyVelocity: number | null; daysOfCover: number | null; trend: "increasing" | "decreasing" | "stable" | null;
  stockStatus: "in-stock" | "out-of-stock" | "reserved-out"; supplierLeadTimeDays: number | null;
  inboundQuantity: null; recommendation: ProductRecommendation; reasons: string[];
  confidence: "high" | "medium" | "needs-data"; coverage: string; suggestedQuantity: number | null;
  shopeeCoverage: "mapped" | "needs-mapping" | "not-connected"; reviewQuality: { count: number; averageRating: number } | null;
  marketplaceNormalizedUnits: number | null;
  marketplaceRevenue: Record<string, MarketplaceRevenueEntry> | null;
  marketplaceCoverage: MarketplaceCoverage | null;
  contributingSalesSkus: ContributingSalesSku[] | null;
};

export type ProductPerformanceData = {
  period: { from: string; to: string; days: number }; defaults: { safetyDays: number };
  products: ProductPerformanceRow[];
  summary: Record<ProductRecommendation, number>;
};
