import type { FinancialCurrencyMetadata } from "@/lib/server/financial-currency";

export interface KpiMetric {
  value: number;
  previousValue?: number;
  change?: number;
  changePercent?: number;
  isPositive: boolean;
}

export interface ExecutiveKpiData {
  currency: FinancialCurrencyMetadata;
  period: { from: string; to: string };
  comparePeriod?: { from: string; to: string };
  kpis: {
    fulfillmentRate: KpiMetric;
    slaCompliance: KpiMetric;
    inventoryTurnover: KpiMetric;
    grossMargin: KpiMetric;
    cashFlow: KpiMetric;
    daysSalesOutstanding: KpiMetric;
    totalRevenue: KpiMetric;
    totalOrders: KpiMetric;
    avgOrderValue: KpiMetric;
  };
  revenueBreakdown: {
    period: string;
    wmsRevenue: number;
    shopeeRevenue: number;
    totalRevenue: number;
  }[];
  channelSplit: {
    channel: string;
    revenue: number;
    orders: number;
    percentage: number;
  }[];
}
