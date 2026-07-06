"use client";

import React, { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useShopeeAds } from "@/hooks/queries/use-shopee-ads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingUp,
  MousePointerClick,
  Eye,
  Percent,
  Target,
  ShoppingCart,
  Wallet,
  Megaphone,
} from "lucide-react";
import type { KpiMetric } from "@/types/executive-kpi";

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

const PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
];

function KpiCard({
  label,
  value,
  metric,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  metric?: KpiMetric;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg p-2" style={{ backgroundColor: `${color}20` }}>
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value}</p>
            </div>
          </div>
          {metric?.changePercent !== undefined && (
            <Badge variant={metric.isPositive ? "success" : "destructive"} className="text-xs">
              {metric.isPositive ? "+" : ""}{metric.changePercent.toFixed(1)}%
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ShopeeAdsDashboard() {
  const [preset, setPreset] = useState(30);
  const { fromDate, toDate } = useMemo(() => {
    const now = new Date();
    return {
      toDate: now.toISOString().split("T")[0] ?? now.toISOString(),
      fromDate: new Date(now.getTime() - preset * 24 * 60 * 60 * 1000).toISOString().split("T")[0] ?? new Date().toISOString(),
    };
  }, [preset]);
  const { data, isLoading } = useShopeeAds({ dateFrom: fromDate, dateTo: toDate });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[100px] rounded-[20px]" />)}
        </div>
        <Skeleton className="h-[300px] rounded-[20px]" />
      </div>
    );
  }

  const { kpis, dailyTrend, campaignBreakdown, totalBalance } = data;
  const topCampaigns = campaignBreakdown.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shopee Ads Dashboard</h1>
          <p className="text-muted-foreground">CPC ads performance tracking</p>
        </div>
        {totalBalance !== undefined && (
          <Card className="border-pink-200 dark:border-pink-900">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg p-2 bg-pink-100 dark:bg-pink-950">
                <Wallet className="h-5 w-5 text-pink-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ads Credit Balance</p>
                <p className="text-lg font-bold">{formatCurrency(totalBalance)}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant={preset === p.days ? "default" : "outline"}
            size="sm"
            onClick={() => setPreset(p.days)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Ad Spend" value={formatCurrency(kpis.spend.value)} metric={kpis.spend} icon={DollarSign} color="#ef4444" />
        <KpiCard label="Ad Revenue" value={formatCurrency(kpis.revenue.value)} metric={kpis.revenue} icon={TrendingUp} color="#22c55e" />
        <KpiCard label="ROAS" value={`${kpis.roas.value.toFixed(2)}x`} metric={kpis.roas} icon={Target} color="#ec4899" />
        <KpiCard label="Clicks" value={formatNumber(kpis.clicks.value)} metric={kpis.clicks} icon={MousePointerClick} color="#3b82f6" />
        <KpiCard label="Impressions" value={formatNumber(kpis.impressions.value)} metric={kpis.impressions} icon={Eye} color="#8b5cf6" />
        <KpiCard label="CTR" value={`${kpis.ctr.value.toFixed(2)}%`} metric={kpis.ctr} icon={Percent} color="#f59e0b" />
        <KpiCard label="CPC" value={formatCurrency(kpis.cpc.value)} metric={kpis.cpc} icon={DollarSign} color="#f97316" />
        <KpiCard label="Orders" value={formatNumber(kpis.orders.value)} metric={kpis.orders} icon={ShoppingCart} color="#06b6d4" />
      </div>

      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Daily Spend vs Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => [formatCurrency(Number(value))]}
                />
                <Area type="monotone" dataKey="spend" name="Spend" stroke="#ef4444" fill="url(#spendGrad)" />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#22c55e" fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {topCampaigns.length > 0 && (
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Campaigns by Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCampaigns} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis
                    type="number"
                    dataKey="campaignId"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(_v, i) => {
                      const c = topCampaigns[i];
                      return c?.campaignName?.slice(0, 18) ?? c?.campaignId ?? "";
                    }}
                    width={140}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                    labelFormatter={(_v, payload) => {
                      const c = payload?.[0]?.payload;
                      return c?.campaignName ?? c?.campaignId ?? "";
                    }}
                  />
                  <Bar dataKey="spend" fill="#ec4899" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {campaignBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Campaign Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignBreakdown.map((c) => (
                  <TableRow key={c.campaignId}>
                    <TableCell className="font-medium">{c.campaignName ?? c.campaignId}</TableCell>
                    <TableCell className="text-muted-foreground">{c.adType ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.spend)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.revenue)}</TableCell>
                    <TableCell className="text-right">{c.roas.toFixed(2)}x</TableCell>
                    <TableCell className="text-right">{formatNumber(c.clicks)}</TableCell>
                    <TableCell className="text-right">{formatNumber(c.impressions)}</TableCell>
                    <TableCell className="text-right">{c.ctr.toFixed(2)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
