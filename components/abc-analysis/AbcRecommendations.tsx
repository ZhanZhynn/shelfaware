"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Package, ShoppingCart } from "lucide-react";
import type { AbcRecommendations as Recs, AbcProduct } from "@/types/abc-analysis";
import { formatMoney } from "@/lib/money";

function formatCurrency(value: number): string {
  return formatMoney(value, "MYR");
}

function RecommendationSection({
  title,
  icon: Icon,
  color,
  products,
  emptyMessage,
  renderItem,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  products: AbcProduct[];
  emptyMessage: string;
  renderItem: (p: AbcProduct) => React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-lg p-1.5" style={{ backgroundColor: `${color}20` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="outline" className="text-xs">{products.length}</Badge>
      </div>
      {products.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-8">{emptyMessage}</p>
      ) : (
        <div className="space-y-2 pl-8">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="truncate max-w-[200px]">{p.name}</span>
              <span className="text-muted-foreground">{renderItem(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AbcRecommendations({ recommendations }: { recommendations: Recs }) {
  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Actionable Recommendations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <RecommendationSection
          title="Dead Stock (High Value, Slow)"
          icon={AlertTriangle}
          color="#ef4444"
          products={recommendations.deadStock}
          emptyMessage="No dead stock detected"
          renderItem={(p) => (
            <span>
              Holding: {formatCurrency(p.holdingValue)} · {p.daysOfStock}d stock
            </span>
          )}
        />
        <RecommendationSection
          title="Priority Restock (A Items Low Stock)"
          icon={ShoppingCart}
          color="#22c55e"
          products={recommendations.priorityRestock}
          emptyMessage="No A-tier items need restocking"
          renderItem={(p) => (
            <span>
              Stock: {p.stockOnHand} units · {p.daysOfStock}d remaining
            </span>
          )}
        />
        <RecommendationSection
          title="Overstocked (>90 Days)"
          icon={Package}
          color="#f59e0b"
          products={recommendations.overstocked.slice(0, 10)}
          emptyMessage="No overstocked items"
          renderItem={(p) => (
            <span>
              {p.daysOfStock}d · {formatCurrency(p.holdingValue)} held
            </span>
          )}
        />
      </CardContent>
    </Card>
  );
}
