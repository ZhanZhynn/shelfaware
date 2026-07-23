"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Users, TrendingUp, AlertTriangle, DollarSign, Crown, Heart, Shield, Skull } from "lucide-react";
import { formatMoney } from "@/lib/money";

interface ClvData {
  summary: {
    totalBuyers: number;
    avgClv: number;
    avgRecency: number;
    avgFrequency: number;
    avgMonetary: number;
  };
  segments: {
    champions: number;
    loyal: number;
    potential: number;
    atRisk: number;
    lost: number;
  };
  churnRisk: {
    high: number;
    medium: number;
    low: number;
  };
  topBuyersByClv: {
    username: string;
    clvEstimate: number;
    orderCount: number;
    avgOrderValue: number;
    recencyDays: number;
    totalSpent: number;
  }[];
}

const SEGMENT_COLORS = {
  champions: "#22c55e",
  loyal: "#3b82f6",
  potential: "#f97316",
  atRisk: "#eab308",
  lost: "#ef4444",
};

const SEGMENT_ICONS = {
  champions: Crown,
  loyal: Heart,
  potential: TrendingUp,
  atRisk: AlertTriangle,
  lost: Skull,
};

const CHURN_COLORS = {
  low: "#22c55e",
  medium: "#f97316",
  high: "#ef4444",
};

export default function ShopeeClvAnalytics() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "clv"],
    queryFn: async () => {
      const response = await apiClient.shopee.getClvAnalytics();
      return response.data;
    },
    enabled: isMounted,
  });

  if (!isMounted) {
    return <Skeleton className="h-96 w-full" />;
  }

  const clv: ClvData = data || {
    summary: { totalBuyers: 0, avgClv: 0, avgRecency: 0, avgFrequency: 0, avgMonetary: 0 },
    segments: { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 },
    churnRisk: { high: 0, medium: 0, low: 0 },
    topBuyersByClv: [],
  };

  const segmentData = Object.entries(clv.segments)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value,
      color: SEGMENT_COLORS[key as keyof typeof SEGMENT_COLORS],
    }));

  const churnData = Object.entries(clv.churnRisk)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1) + " Risk",
      value,
      color: CHURN_COLORS[key as keyof typeof CHURN_COLORS],
    }));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Buyers</p>
                <p className="text-lg font-bold">{clv.summary.totalBuyers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg CLV</p>
                <p className="text-lg font-bold">RM {clv.summary.avgClv.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <TrendingUp className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Recency</p>
                <p className="text-lg font-bold">{clv.summary.avgRecency}d</p>
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
                <p className="text-xs text-muted-foreground">Avg Frequency</p>
                <p className="text-lg font-bold">{clv.summary.avgFrequency}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Monetary</p>
                <p className="text-lg font-bold">RM {clv.summary.avgMonetary.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RFM Segments Pie */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Customer Segments (RFM)</CardTitle>
          </CardHeader>
          <CardContent>
            {segmentData.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No segment data
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={segmentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {segmentData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {segmentData.map((s) => {
                    const Icon = SEGMENT_ICONS[s.name.toLowerCase() as keyof typeof SEGMENT_ICONS] || Users;
                    return (
                      <div key={s.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" style={{ color: s.color }} />
                          <span className="text-muted-foreground">{s.name}</span>
                        </div>
                        <span className="font-medium">{s.value}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Churn Risk Pie */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Churn Risk</CardTitle>
          </CardHeader>
          <CardContent>
            {churnData.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No churn data
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={churnData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {churnData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {churnData.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-muted-foreground">{c.name}</span>
                      </div>
                      <span className="font-medium">{c.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              High risk = no orders in 90+ days
            </p>
          </CardContent>
        </Card>

        {/* Top Buyers by CLV */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top Buyers by CLV</CardTitle>
          </CardHeader>
          <CardContent>
            {clv.topBuyersByClv.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No buyer data
              </div>
            ) : (
              <div className="space-y-2">
                {clv.topBuyersByClv.slice(0, 5).map((buyer, i) => (
                  <div key={buyer.username} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{buyer.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {buyer.orderCount} orders · RM {buyer.avgOrderValue.toFixed(2)} avg
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-sm font-bold text-emerald-500">RM {buyer.clvEstimate.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">{buyer.recencyDays}d ago</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Buyers Bar Chart */}
      {clv.topBuyersByClv.length > 0 && (
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">CLV by Buyer</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={clv.topBuyersByClv}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="username" className="text-xs" tick={{ fontSize: 10 }} />
                <YAxis className="text-xs" tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value) => [formatMoney(Number(value), "MYR"), "CLV"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="clvEstimate" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
