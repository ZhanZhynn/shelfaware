import type { KpiMetric } from "@/types/executive-kpi";

export interface ShopeeAdsDailyPoint {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  roas: number;
}

export interface ShopeeAdsCampaignRow {
  campaignId: string;
  campaignName: string | null;
  adType: string | null;
  placement: string | null;
  spend: number;
  revenue: number;
  roas: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface ShopeeAdsData {
  period: { from: string; to: string };
  comparePeriod?: { from: string; to: string };
  kpis: {
    spend: KpiMetric;
    revenue: KpiMetric;
    roas: KpiMetric;
    clicks: KpiMetric;
    impressions: KpiMetric;
    ctr: KpiMetric;
    cpc: KpiMetric;
    conversions: KpiMetric;
    orders: KpiMetric;
  };
  dailyTrend: ShopeeAdsDailyPoint[];
  campaignBreakdown: ShopeeAdsCampaignRow[];
  totalBalance?: number;
}
