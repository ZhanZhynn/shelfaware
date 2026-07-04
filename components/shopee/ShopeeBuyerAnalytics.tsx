"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api";
import { Users, Repeat, MapPin } from "lucide-react";

interface BuyerAnalytics {
  totalBuyers: number;
  repeatBuyers: number;
  repeatRate: number;
  avgOrdersPerBuyer: number;
  topBuyers: { username: string; totalSpent: number; orderCount: number }[];
  geographicDistribution: { region: string; count: number }[];
  spendingTiers: { tier: string; count: number }[];
}

const PIE_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#8b5cf6", "#ec4899"];

export default function ShopeeBuyerAnalytics() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "buyers"],
    queryFn: async () => {
      const response = await apiClient.shopee.getBuyerAnalytics();
      return response.data;
    },
  });

  if (!isMounted) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[200px]" />
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[200px]" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const analytics: BuyerAnalytics = data || {
    totalBuyers: 0,
    repeatBuyers: 0,
    repeatRate: 0,
    avgOrdersPerBuyer: 0,
    topBuyers: [],
    geographicDistribution: [],
    spendingTiers: [],
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Users className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Buyers</p>
                <p className="text-lg font-bold">{analytics.totalBuyers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Repeat className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Repeat Buyers</p>
                <p className="text-lg font-bold">{analytics.repeatBuyers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Repeat className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Repeat Rate</p>
                <p className="text-lg font-bold">{analytics.repeatRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Users className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Orders/Buyer</p>
                <p className="text-lg font-bold">{analytics.avgOrdersPerBuyer.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Buyers */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Buyers by Spend</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.topBuyers.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No buyer data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.topBuyers} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tickFormatter={(v) => `$${v}`} className="text-xs" />
                  <YAxis
                    dataKey="username"
                    type="category"
                    width={80}
                    className="text-xs"
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(2)}`, "Total Spent"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="totalSpent" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Spending Tiers */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Spending Tiers</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.spendingTiers.every((t) => t.count === 0) ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No spending data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={analytics.spendingTiers.filter((t) => t.count > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="tier"
                  >
                    {analytics.spendingTiers
                      .filter((t) => t.count > 0)
                      .map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`${Number(value)} buyers`, "Count"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Geographic Distribution */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-500" />
              Geographic Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.geographicDistribution.length === 0 ? (
              <div className="flex items-center justify-center h-[150px] text-muted-foreground">
                No geographic data available
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {analytics.geographicDistribution.map((geo) => (
                  <div key={geo.region} className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground truncate">{geo.region}</p>
                    <p className="text-lg font-bold">{geo.count}</p>
                    <p className="text-xs text-muted-foreground">orders</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
