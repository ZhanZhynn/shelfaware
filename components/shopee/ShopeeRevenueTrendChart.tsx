"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api";
import { TrendingUp, Calendar } from "lucide-react";

interface RevenueTrendData {
  period: string;
  revenue: number;
  orders: number;
}

type Granularity = "daily" | "weekly" | "monthly";

export default function ShopeeRevenueTrendChart() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("daily");

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "revenue-trend", granularity],
    queryFn: async () => {
      const response = await apiClient.shopee.getRevenueTrend(granularity);
      return response.data;
    },
  });

  if (!isMounted) {
    return (
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px]" />
        </CardContent>
      </Card>
    );
  }

  const chartData = (data?.data || []).map((d: RevenueTrendData) => ({
    ...d,
    label: d.period.length > 10 ? d.period.substring(5) : d.period,
    revenue: Number(d.revenue),
    orders: Number(d.orders),
  }));

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-orange-500" />
          Revenue Trend
        </CardTitle>
        <div className="flex gap-1">
          {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
            <Button
              key={g}
              variant={granularity === g ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setGranularity(g)}
            >
              {g}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[250px]" />
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground">
            No revenue data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                className="text-xs"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) => `$${v}`}
                className="text-xs"
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(value, name) => [
                  name === "revenue" ? `${Number(value).toFixed(2)}` : value,
                  name === "revenue" ? "Revenue" : "Orders",
                ]}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#f97316"
                strokeWidth={2}
                fill="url(#revenueGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
