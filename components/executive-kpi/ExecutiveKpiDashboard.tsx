"use client";

import React, { useState } from "react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useExecutiveKpi } from "@/hooks/queries/use-executive-kpi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Target,
  ShieldCheck,
  RefreshCw,
  DollarSign,
  Clock,
  ShoppingCart,
  BarChart3,
  Zap,
} from "lucide-react";

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
  { label: "1Y", days: 365 },
];

const PIE_COLORS = ["#3b82f6", "#f97316"];

function KpiCard({
  label,
  value,
  changePercent,
  isPositive,
  subValue,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  changePercent?: number;
  isPositive?: boolean;
  subValue?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  const changeColor =
    isPositive !== false ? "text-emerald-600" : "text-rose-600";

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
          {changePercent !== undefined && (
            <Badge variant={isPositive ? "success" : "destructive"} className="text-xs">
              {isPositive ? "+" : ""}{changePercent.toFixed(1)}%
            </Badge>
          )}
        </div>
        {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
      </CardContent>
    </Card>
  );
}

export default function ExecutiveKpiDashboard() {
  const [preset, setPreset] = useState(30);
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(new Date(toDate).getTime() - preset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, isLoading } = useExecutiveKpi({ dateFrom: fromDate, dateTo: toDate });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-[100px] rounded-[20px]" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[300px] rounded-[20px]" />
          <Skeleton className="h-[300px] rounded-[20px]" />
        </div>
      </div>
    );
  }

  const { kpis, revenueBreakdown, channelSplit } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Executive KPI Dashboard</h1>
        <p className="text-muted-foreground">Combined WMS + Shopee performance overview</p>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard label="Total Revenue" value={formatCurrency(kpis.totalRevenue.value)} icon={DollarSign} color="#22c55e" changePercent={kpis.totalRevenue.changePercent} isPositive={kpis.totalRevenue.isPositive}
          subValue={`WMS: ${formatCurrency(channelSplit[0]?.revenue ?? 0)} · Shopee: ${formatCurrency(channelSplit[1]?.revenue ?? 0)}`} />
        <KpiCard label="Total Orders" value={formatNumber(kpis.totalOrders.value)} icon={ShoppingCart} color="#3b82f6" changePercent={kpis.totalOrders.changePercent} isPositive={kpis.totalOrders.isPositive}
          subValue={`${channelSplit[0]?.orders ?? 0} WMS · ${channelSplit[1]?.orders ?? 0} Shopee`} />
        <KpiCard label="Avg Order Value" value={formatCurrency(kpis.avgOrderValue.value)} icon={BarChart3} color="#8b5cf6" changePercent={kpis.avgOrderValue.changePercent} isPositive={kpis.avgOrderValue.isPositive} />
        <KpiCard label="Fulfillment Rate" value={`${kpis.fulfillmentRate.value.toFixed(1)}%`} icon={Target} color="#22c55e" changePercent={kpis.fulfillmentRate.changePercent} isPositive={kpis.fulfillmentRate.isPositive} />
        <KpiCard label="SLA Compliance" value={`${kpis.slaCompliance.value.toFixed(1)}%`} icon={ShieldCheck} color="#3b82f6" changePercent={kpis.slaCompliance.changePercent} isPositive={kpis.slaCompliance.isPositive} />
        <KpiCard label="Gross Margin" value={`${kpis.grossMargin.value.toFixed(1)}%`} icon={TrendingUp} color="#f59e0b" changePercent={kpis.grossMargin.changePercent} isPositive={kpis.grossMargin.isPositive} />
        <KpiCard label="Inventory Turnover" value={`${kpis.inventoryTurnover.value.toFixed(2)}x`} icon={RefreshCw} color="#8b5cf6" changePercent={kpis.inventoryTurnover.changePercent} isPositive={kpis.inventoryTurnover.isPositive} />
        <KpiCard label="Cash Flow" value={formatCurrency(kpis.cashFlow.value)} icon={Zap} color={kpis.cashFlow.isPositive ? "#22c55e" : "#ef4444"} changePercent={kpis.cashFlow.changePercent} isPositive={kpis.cashFlow.isPositive} />
        <KpiCard label="Days Sales Outstanding" value={`${kpis.daysSalesOutstanding.value.toFixed(0)}d`} icon={Clock} color="#f97316" changePercent={kpis.daysSalesOutstanding.changePercent} isPositive={!kpis.daysSalesOutstanding.isPositive} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueBreakdown} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <defs>
                    <linearGradient id="wmsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="shopeeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => [formatCurrency(Number(value))]}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="wmsRevenue" name="WMS" stroke="#3b82f6" fill="url(#wmsGrad)" />
                  <Area type="monotone" dataKey="shopeeRevenue" name="Shopee" stroke="#f97316" fill="url(#shopeeGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Channel Split</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channelSplit.map((c) => ({ name: c.channel, value: c.revenue }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {channelSplit.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => [formatCurrency(Number(value))]}
                  />
                  <text x="50%" y="48%" textAnchor="middle" className="fill-foreground text-lg font-bold">
                    {formatCurrency(channelSplit.reduce((s, c) => s + c.revenue, 0))}
                  </text>
                  <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-xs">
                    Total Revenue
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-2">
              {channelSplit.map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: channelSplit.indexOf(c) === 0 ? "#3b82f6" : "#f97316" }} />
                  <span>{c.channel}</span>
                  <span className="text-muted-foreground">{c.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
