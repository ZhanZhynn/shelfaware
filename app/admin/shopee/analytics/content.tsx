"use client";

import { useState } from "react";
import ShopeeRevenueTrendChart from "@/components/shopee/ShopeeRevenueTrendChart";
import ShopeeBuyerAnalytics from "@/components/shopee/ShopeeBuyerAnalytics";
import ShopeeProductPerformance from "@/components/shopee/ShopeeProductPerformance";
import ShopeeDateRangeFilter from "@/components/shopee/ShopeeDateRangeFilter";

export default function ShopeeAnalyticsContent() {
  const [dateRange, setDateRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shopee Analytics</h1>
          <p className="text-muted-foreground">
            Revenue trends, buyer insights, and product performance
          </p>
        </div>
      </div>

      <ShopeeDateRangeFilter
        onDateRangeChange={(from, to) => setDateRange({ from, to })}
        initialFrom={dateRange.from}
        initialTo={dateRange.to}
      />

      <ShopeeRevenueTrendChart />

      <ShopeeBuyerAnalytics />

      <ShopeeProductPerformance />
    </div>
  );
}
