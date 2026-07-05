"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

interface LowStockProduct {
  id: string;
  shopeeItemId: number;
  itemName: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  isOutOfStock: boolean;
  isLowStock: boolean;
}

export default function ShopeeLowStockAlertWidget() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "low-stock-alerts"],
    queryFn: async () => {
      const response = await apiClient.shopee.getProductPerformance();
      return response.data;
    },
    enabled: isMounted,
    refetchInterval: 5 * 60 * 1000,
  });

  if (!isMounted) {
    return <Skeleton className="h-48 w-full" />;
  }

  const products: LowStockProduct[] = data?.products || [];
  const summary = data?.summary || { outOfStock: 0, lowStock: 0, totalProducts: 0 };

  const outOfStockProducts = products.filter((p) => p.isOutOfStock);
  const lowStockProducts = products.filter((p) => p.isLowStock && !p.isOutOfStock);
  const totalIssues = summary.outOfStock + summary.lowStock;

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Package className="h-5 w-5" />
          Stock Alerts
          {totalIssues > 0 && (
            <Badge variant="destructive" className="ml-2">
              {totalIssues}
            </Badge>
          )}
        </CardTitle>
        <Link
          href="/admin/shopee/products"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View products →
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : totalIssues === 0 ? (
          <div className="flex items-center gap-3 py-6">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <div>
              <p className="font-medium text-green-500">All Clear</p>
              <p className="text-sm text-muted-foreground">
                All products have sufficient stock
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary badges */}
            <div className="flex gap-2 flex-wrap">
              {summary.outOfStock > 0 && (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" />
                  {summary.outOfStock} Out of Stock
                </Badge>
              )}
              {summary.lowStock > 0 && (
                <Badge variant="warning">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {summary.lowStock} Low Stock
                </Badge>
              )}
            </div>

            {/* Product list — show up to 5 most critical */}
            <div className="space-y-1.5">
              {outOfStockProducts.slice(0, 3).map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <p className="text-sm font-medium truncate">{product.itemName}</p>
                  </div>
                  <span className="text-sm font-medium text-red-500 shrink-0 ml-3">
                    0 stock
                  </span>
                </div>
              ))}
              {lowStockProducts.slice(0, 5 - Math.min(outOfStockProducts.length, 3)).map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 bg-orange-500/10 border border-orange-500/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                    <p className="text-sm font-medium truncate">{product.itemName}</p>
                  </div>
                  <span className="text-sm font-medium text-orange-500 shrink-0 ml-3">
                    {product.stock} left
                  </span>
                </div>
              ))}
            </div>

            {totalIssues > 5 && (
              <p className="text-xs text-muted-foreground text-center">
                +{totalIssues - 5} more products need restocking
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
