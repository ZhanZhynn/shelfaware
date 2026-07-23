"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Package, ShoppingCart, DollarSign, TrendingUp } from "lucide-react";
import { formatMoney } from "@/lib/money";

interface MarketplaceStatsCardsProps {
  stats: {
    totalProducts: number;
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
  };
  titlePrefix?: string;
}

export default function MarketplaceStatsCards({
  stats,
  titlePrefix,
}: MarketplaceStatsCardsProps) {
  const prefix = titlePrefix ? `${titlePrefix} ` : "";

  const cards = [
    {
      title: `${prefix}Products`,
      value: stats.totalProducts.toLocaleString(),
      icon: Package,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: `${prefix}Orders`,
      value: stats.totalOrders.toLocaleString(),
      icon: ShoppingCart,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      title: `${prefix}${titlePrefix ? "Total Revenue" : "Revenue"}`,
      value: formatMoney(stats.totalRevenue, "MYR"),
      icon: DollarSign,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      title: `${prefix}Avg Order Value`,
      value: formatMoney(stats.averageOrderValue, "MYR"),
      icon: TrendingUp,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.title} className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
