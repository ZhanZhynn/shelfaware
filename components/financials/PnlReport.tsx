"use client";

import React, { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { usePnl } from "@/hooks/queries/use-pnl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, Receipt, ArrowDown, ShoppingCart, RotateCcw, Truck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { CurrencyReconciliation } from "./CurrencyReconciliation";

const PERIODS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "this_year", label: "This Year" },
];

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  change,
  changeLabel,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  change?: number;
  changeLabel?: string;
}) {
  const isPositive = change !== undefined ? change >= 0 : undefined;
  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
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
          {change !== undefined && (
            <Badge variant={isPositive ? "success" : "destructive"} className="text-xs">
              {isPositive ? "+" : ""}{change.toFixed(1)}%
            </Badge>
          )}
        </div>
        {changeLabel && <p className="text-xs text-muted-foreground mt-1">{changeLabel}</p>}
      </CardContent>
    </Card>
  );
}

export default function PnlReport() {
  const [period, setPeriod] = useState("this_month");
  const { data, isLoading } = usePnl({ period });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[100px] rounded-[20px]" />)}
        </div>
        <Skeleton className="h-[400px] rounded-[20px]" />
      </div>
    );
  }

  const { current, previous, monthlyTrend } = data;
  const formatCurrency = (value: number) => formatMoney(value, data.currency.baseCurrency);

  const pctChange = (curr: number, prev: number) =>
    prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profit & Loss Report</h1>
        <p className="text-muted-foreground">{data.period.label} · {data.currency.baseCurrency}</p>
        {data.currency.excludedCurrencies.length > 0 && (
          <p className="text-xs text-amber-700">Excluded currencies without a persisted exchange rate: {data.currency.excludedCurrencies.join(", ")}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={period === p.value ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <CurrencyReconciliation />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Total Revenue"
          value={formatCurrency(current.revenue.total)}
          icon={DollarSign}
          color="#22c55e"
          change={pctChange(current.revenue.total, previous?.revenue.total ?? 0)}
          changeLabel={`WMS: ${formatCurrency(current.revenue.wms)} · Shopee: ${formatCurrency(current.revenue.shopee)}`}
        />
        <MetricCard
          label="Cost of Goods Sold"
          value={formatCurrency(current.cogs.total)}
          icon={ShoppingCart}
          color="#f59e0b"
        />
        <MetricCard
          label="Gross Profit"
          value={formatCurrency(current.grossProfit)}
          icon={TrendingUp}
          color="#22c55e"
          change={pctChange(current.grossProfit, previous?.grossProfit ?? 0)}
          changeLabel={`${current.grossMargin.toFixed(1)}% margin`}
        />
        <MetricCard
          label="Marketplace Fees"
          value={formatCurrency(current.expenses.marketplaceFees)}
          icon={Receipt}
          color="#ef4444"
        />
        <MetricCard
          label="Shipping Costs"
          value={formatCurrency(current.expenses.shippingCosts)}
          icon={Truck}
          color="#8b5cf6"
        />
        <MetricCard
          label="Net Profit"
          value={formatCurrency(current.netProfit)}
          icon={current.netProfit >= 0 ? TrendingUp : TrendingDown}
          color={current.netProfit >= 0 ? "#22c55e" : "#ef4444"}
          change={pctChange(current.netProfit, previous?.netProfit ?? 0)}
          changeLabel={`${current.netMargin.toFixed(1)}% margin`}
        />
      </div>

      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => [formatCurrency(Number(value))]}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cogs" name="COGS" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="Net Profit" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Period Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium text-muted-foreground">Line Item</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Current</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Previous</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Change</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Revenue", curr: current.revenue.total, prev: previous?.revenue.total ?? 0 },
                  { label: "  WMS", curr: current.revenue.wms, prev: previous?.revenue.wms ?? 0 },
                  { label: "  Shopee", curr: current.revenue.shopee, prev: previous?.revenue.shopee ?? 0 },
                  { label: "COGS", curr: current.cogs.total, prev: previous?.cogs.total ?? 0, invert: true },
                  { label: "Gross Profit", curr: current.grossProfit, prev: previous?.grossProfit ?? 0, bold: true },
                  { label: "Marketplace Fees", curr: current.expenses.marketplaceFees, prev: previous?.expenses.marketplaceFees ?? 0, invert: true },
                  { label: "Shipping", curr: current.expenses.shippingCosts, prev: previous?.expenses.shippingCosts ?? 0, invert: true },
                  { label: "Returns", curr: current.expenses.returns, prev: previous?.expenses.returns ?? 0, invert: true },
                  { label: "Net Profit", curr: current.netProfit, prev: previous?.netProfit ?? 0, bold: true },
                ].map((row) => {
                  const change = pctChange(row.curr, row.prev);
                  return (
                    <tr key={row.label} className={`border-b border-border/50 ${row.bold ? "font-semibold" : ""}`}>
                      <td className="py-2">{row.label}</td>
                      <td className="text-right py-2">{formatCurrency(row.curr)}</td>
                      <td className="text-right py-2 text-muted-foreground">{formatCurrency(row.prev)}</td>
                      <td className={`text-right py-2 ${change >= 0 ? (row.invert ? "text-red-600" : "text-emerald-600") : (row.invert ? "text-emerald-600" : "text-red-600")}`}>
                        {change >= 0 ? "+" : ""}{change.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
