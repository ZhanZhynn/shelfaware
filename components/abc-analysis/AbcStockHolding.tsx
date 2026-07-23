"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AbcProduct } from "@/types/abc-analysis";
import { formatMoney } from "@/lib/money";

function formatCurrency(value: number): string {
  return formatMoney(value, "MYR");
}

export default function AbcStockHolding({ products }: { products: AbcProduct[] }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const chartData = products
    .filter((p) => p.holdingValue > 0)
    .sort((a, b) => b.holdingValue - a.holdingValue)
    .slice(0, 15)
    .map((p) => ({
      name: p.name.length > 18 ? p.name.slice(0, 18) + "…" : p.name,
      holdingValue: p.holdingValue,
      tier: p.tier,
    }));

  const tierColors = { A: "#22c55e", B: "#f59e0b", C: "#ef4444" };

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Stock Holding Value by Product</CardTitle>
        <p className="text-xs text-muted-foreground">Top 15 products by holding value (price × quantity on hand)</p>
      </CardHeader>
      <CardContent>
        {mounted && chartData.length > 0 ? (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => formatMoney(Number(v), "MYR")} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => [formatCurrency(Number(value)), "Holding Value"]}
                />
                <Bar dataKey="holdingValue" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <rect key={index} fill={tierColors[entry.tier as keyof typeof tierColors] || "#8884d8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            No stock holding data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
