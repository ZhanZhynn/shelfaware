"use client";

import React, { useState } from "react";
import { useAbcAnalysis } from "@/hooks/queries/use-abc-analysis";
import AbcSummaryCards from "./AbcSummaryCards";
import AbcParetoChart from "./AbcParetoChart";
import AbcProductTable from "./AbcProductTable";
import AbcStockHolding from "./AbcStockHolding";
import AbcRecommendations from "./AbcRecommendations";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

export default function AbcDashboard() {
  const [preset, setPreset] = useState(30);
  const [channel, setChannel] = useState<"all" | "wms" | "shopee">("all");

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(new Date(toDate).getTime() - preset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, isLoading } = useAbcAnalysis({
    dateFrom: fromDate,
    dateTo: toDate,
    channel: channel === "all" ? undefined : channel,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-[20px]" />
          ))}
        </div>
        <Skeleton className="h-[400px] rounded-[20px]" />
        <Skeleton className="h-[400px] rounded-[20px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ABC Inventory Analysis</h1>
        <p className="text-muted-foreground">
          Classify products by revenue contribution and optimize stock levels
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <div className="ml-2 flex items-center gap-1">
          {(["all", "wms", "shopee"] as const).map((ch) => (
            <Button
              key={ch}
              variant={channel === ch ? "default" : "outline"}
              size="sm"
              onClick={() => setChannel(ch)}
              className="text-xs"
            >
              {ch === "all" ? "All Channels" : ch === "wms" ? "WMS" : "Shopee"}
            </Button>
          ))}
        </div>
      </div>

      <AbcSummaryCards
        tierA={data.summary.tierA}
        tierB={data.summary.tierB}
        tierC={data.summary.tierC}
        totalRevenue={data.summary.totalRevenue}
        totalStockValue={data.summary.totalStockValue}
      />

      <AbcParetoChart data={data.paretoData} />

      <Tabs defaultValue="products">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="products">All Products</TabsTrigger>
          <TabsTrigger value="stock">Stock Holding</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <AbcProductTable products={data.products} />
        </TabsContent>
        <TabsContent value="stock" className="mt-4">
          <AbcStockHolding products={data.products} />
        </TabsContent>
        <TabsContent value="recommendations" className="mt-4">
          <AbcRecommendations recommendations={data.recommendations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
