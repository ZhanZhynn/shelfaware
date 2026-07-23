"use client";

import React from "react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AbcParetoPoint } from "@/types/abc-analysis";
import { formatMoney } from "@/lib/money";

export default function AbcParetoChart({ data }: { data: AbcParetoPoint[] }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || data.length === 0) return null;

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Pareto Analysis</CardTitle>
        <p className="text-xs text-muted-foreground">
          Revenue contribution by product (top 30) with cumulative percentage
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="product"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                yAxisId="revenue"
                orientation="left"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => formatMoney(Number(v), "MYR")}
              />
              <YAxis
                yAxisId="percent"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value, name) => [
                  name === "revenue"
                    ? formatMoney(Number(value), "MYR")
                    : `${Number(value).toFixed(1)}%`,
                  name === "revenue" ? "Revenue" : "Cumulative %",
                ]}
              />
              <ReferenceLine
                yAxisId="percent"
                y={80}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                label={{ value: "80%", position: "right", fill: "#f59e0b", fontSize: 11 }}
              />
              <ReferenceLine
                yAxisId="percent"
                y={95}
                stroke="#ef4444"
                strokeDasharray="3 3"
                label={{ value: "95%", position: "right", fill: "#ef4444", fontSize: 11 }}
              />
              <Bar
                yAxisId="revenue"
                dataKey="revenue"
                fill="hsl(var(--chart-1) / 0.7)"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="cumulativePercent"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ r: 3, fill: "#f97316" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
