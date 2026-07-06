import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";
import type { ShopeeAdsData, ShopeeAdsDailyPoint, ShopeeAdsCampaignRow } from "@/types/shopee-ads";
import type { KpiMetric } from "@/types/executive-kpi";

function kpi(current: number, previous?: number): KpiMetric {
  const change = previous !== undefined ? current - previous : undefined;
  const changePercent = previous !== undefined && previous !== 0
    ? ((current - previous) / Math.abs(previous)) * 100
    : undefined;
  return {
    value: Math.round(current * 100) / 100,
    previousValue: previous !== undefined ? Math.round(previous * 100) / 100 : undefined,
    change: change !== undefined ? Math.round(change * 100) / 100 : undefined,
    changePercent: changePercent !== undefined ? Math.round(changePercent * 100) / 100 : undefined,
    isPositive: change !== undefined ? change >= 0 : true,
  };
}

interface AdsAggregate {
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  orders: number;
  conversions: number;
}

function aggregateRows(rows: { impressions: number; clicks: number; expense: number; directGmv: number; directOrder: number; directConversions: number }[]): AdsAggregate {
  return {
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    spend: rows.reduce((s, r) => s + r.expense, 0),
    revenue: rows.reduce((s, r) => s + r.directGmv, 0),
    orders: rows.reduce((s, r) => s + r.directOrder, 0),
    conversions: rows.reduce((s, r) => s + r.directConversions, 0),
  };
}

function computeKpis(agg: AdsAggregate) {
  return {
    spend: agg.spend,
    revenue: agg.revenue,
    roas: agg.spend > 0 ? agg.revenue / agg.spend : 0,
    clicks: agg.clicks,
    impressions: agg.impressions,
    ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
    cpc: agg.clicks > 0 ? agg.spend / agg.clicks : 0,
    conversions: agg.conversions,
    orders: agg.orders,
  };
}

export async function getShopeeAdsForUser(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<ShopeeAdsData> {
  const now = new Date();
  const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo ? new Date(dateTo) : now;
  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
  const prevFrom = new Date(from.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const prevTo = new Date(from);

  // Find user's shops
  const shops = await prisma.shopeeShop.findMany({
    where: { userId },
    select: { id: true },
  });
  const shopIds = shops.map((s) => s.id);

  if (shopIds.length === 0) {
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        spend: kpi(0), revenue: kpi(0), roas: kpi(0), clicks: kpi(0),
        impressions: kpi(0), ctr: kpi(0), cpc: kpi(0), conversions: kpi(0), orders: kpi(0),
      },
      dailyTrend: [],
      campaignBreakdown: [],
    };
  }

  const [dailyRows, campaignRows, prevDailyRows, latestBalanceRow] = await Promise.all([
    prisma.shopeeAdsDailyPerformance.findMany({
      where: { shopId: { in: shopIds }, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
    prisma.shopeeAdsCampaignDailyPerformance.findMany({
      where: { shopId: { in: shopIds }, date: { gte: from, lte: to } },
    }),
    prisma.shopeeAdsDailyPerformance.findMany({
      where: { shopId: { in: shopIds }, date: { gte: prevFrom, lte: prevTo } },
    }),
    prisma.shopeeAdsDailyPerformance.findFirst({
      where: { shopId: { in: shopIds }, totalBalance: { not: null } },
      orderBy: { date: "desc" },
      select: { totalBalance: true },
    }),
  ]);

  const currentAgg = aggregateRows(dailyRows);
  const prevAgg = aggregateRows(prevDailyRows);
  const currentKpis = computeKpis(currentAgg);
  const prevKpis = computeKpis(prevAgg);

  // Daily trend
  const dailyTrend: ShopeeAdsDailyPoint[] = dailyRows.map((r) => ({
    date: r.date.toISOString().split("T")[0] ?? r.date.toISOString(),
    impressions: r.impressions,
    clicks: r.clicks,
    spend: Math.round(r.expense * 100) / 100,
    revenue: Math.round(r.directGmv * 100) / 100,
    roas: r.expense > 0 ? Math.round((r.directGmv / r.expense) * 100) / 100 : 0,
  }));

  // Campaign breakdown — group by campaignId, sum metrics, sort by spend desc
  const campaignMap = new Map<string, {
    campaignId: string;
    campaignName: string | null;
    adType: string | null;
    placement: string | null;
    spend: number;
    revenue: number;
    clicks: number;
    impressions: number;
  }>();

  for (const r of campaignRows) {
    const existing = campaignMap.get(r.campaignId);
    if (existing) {
      existing.spend += r.expense;
      existing.revenue += r.directGmv;
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
    } else {
      campaignMap.set(r.campaignId, {
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adType: r.adType,
        placement: r.campaignPlacement,
        spend: r.expense,
        revenue: r.directGmv,
        clicks: r.clicks,
        impressions: r.impressions,
      });
    }
  }

  const campaignBreakdown: ShopeeAdsCampaignRow[] = Array.from(campaignMap.values())
    .map((c) => ({
      ...c,
      spend: Math.round(c.spend * 100) / 100,
      revenue: Math.round(c.revenue * 100) / 100,
      roas: c.spend > 0 ? Math.round((c.revenue / c.spend) * 100) / 100 : 0,
      ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  logger.info(
    `[Shopee Ads] Aggregated ${dailyRows.length} daily rows, ${campaignRows.length} campaign rows for user ${userId}`,
  );

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    comparePeriod: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
    kpis: {
      spend: kpi(currentKpis.spend, prevKpis.spend),
      revenue: kpi(currentKpis.revenue, prevKpis.revenue),
      roas: kpi(currentKpis.roas, prevKpis.roas),
      clicks: kpi(currentKpis.clicks, prevKpis.clicks),
      impressions: kpi(currentKpis.impressions, prevKpis.impressions),
      ctr: kpi(currentKpis.ctr, prevKpis.ctr),
      cpc: kpi(currentKpis.cpc, prevKpis.cpc),
      conversions: kpi(currentKpis.conversions, prevKpis.conversions),
      orders: kpi(currentKpis.orders, prevKpis.orders),
    },
    dailyTrend,
    campaignBreakdown,
    totalBalance: latestBalanceRow?.totalBalance ?? undefined,
  };
}
