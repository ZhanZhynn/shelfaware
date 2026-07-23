"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Box, DollarSign, ShoppingCart } from "lucide-react";
import type { AbcTierSummary } from "@/types/abc-analysis";
import { formatMoney } from "@/lib/money";

function formatCurrency(value: number): string {
  return formatMoney(value, "MYR");
}

function TierCard({
  label,
  color,
  data,
  icon: Icon,
}: {
  label: string;
  color: string;
  data: AbcTierSummary;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="rounded-lg p-2"
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{data.count}</p>
            </div>
          </div>
          <Badge
            className="text-xs"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {data.revenuePercent.toFixed(1)}%
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Revenue</p>
            <p className="font-medium">{formatCurrency(data.revenue)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Stock Value</p>
            <p className="font-medium">{formatCurrency(data.stockValue)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AbcSummaryCards({
  tierA,
  tierB,
  tierC,
  totalRevenue,
  totalStockValue,
}: {
  tierA: AbcTierSummary;
  tierB: AbcTierSummary;
  tierC: AbcTierSummary;
  totalRevenue: number;
  totalStockValue: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <TierCard label="A Items" color="#22c55e" data={tierA} icon={TrendingUp} />
      <TierCard label="B Items" color="#f59e0b" data={tierB} icon={Box} />
      <TierCard label="C Items" color="#ef4444" data={tierC} icon={TrendingDown} />
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg p-2 bg-sky-500/15">
              <DollarSign className="h-4 w-4 text-sky-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
              <p className="text-lg font-bold">{formatCurrency(totalRevenue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg p-2 bg-violet-500/15">
              <ShoppingCart className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Stock Value</p>
              <p className="text-lg font-bold">{formatCurrency(totalStockValue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
