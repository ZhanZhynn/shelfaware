"use client";

import ShopeeProfitDashboard from "@/components/shopee/ShopeeProfitDashboard";

export default function ShopeeProfitContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shopee Profit Tracking</h1>
        <p className="text-muted-foreground">
          Fees, commission, and ROI analysis per product
        </p>
      </div>

      <ShopeeProfitDashboard />
    </div>
  );
}
