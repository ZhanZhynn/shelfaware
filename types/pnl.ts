import type { FinancialCurrencyMetadata } from "@/lib/server/financial-currency";

export interface PnlData {
  revenue: {
    wms: number;
    shopee: number;
    total: number;
  };
  cogs: {
    wms: number;
    shopee: number;
    total: number;
  };
  grossProfit: number;
  grossMargin: number;
  expenses: {
    marketplaceFees: number;
    shippingCosts: number;
    returns: number;
    total: number;
  };
  netProfit: number;
  netMargin: number;
}

export interface PnlMonthlyTrend {
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

export interface PnlReport {
  currency: FinancialCurrencyMetadata;
  period: { from: string; to: string; label: string };
  comparePeriod?: { from: string; to: string; label: string };
  current: PnlData;
  previous?: PnlData;
  monthlyTrend: PnlMonthlyTrend[];
}
