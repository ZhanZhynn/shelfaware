"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { formatMoney } from "@/lib/money";

interface ShopeeTopProductsTableProps {
  data: { name: string; revenue: number; quantity: number }[];
}

export default function ShopeeTopProductsTable({ data }: ShopeeTopProductsTableProps) {
  const products = data.slice(0, 8);

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Products by Revenue</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground">
            No product data available
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-[2rem_1fr_6rem_5rem] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>#</span>
              <span>Product</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Sold</span>
            </div>
            {/* Rows */}
            {products.map((product, i) => (
              <div
                key={product.name}
                className="grid grid-cols-[2rem_1fr_6rem_5rem] gap-2 items-center text-sm px-1 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
              >
                <span className="text-muted-foreground font-medium">
                  {i + 1}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate" title={product.name}>
                    {product.name}
                  </span>
                </div>
                <span className="text-right font-medium tabular-nums">
                  {formatMoney(product.revenue, "MYR")}
                </span>
                <span className="text-right">
                  <Badge variant="secondary" className="tabular-nums text-xs">
                    {product.quantity.toLocaleString()}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
