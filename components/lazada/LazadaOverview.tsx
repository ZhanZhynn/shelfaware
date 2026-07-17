"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Store,
  LinkIcon,
  RefreshCw,
  Package,
  ShoppingCart,
  History,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import {
  MarketplaceStatsCards,
  MarketplaceDateRangeFilter,
  MarketplaceRevenueTrendChart,
  MarketplaceOrderStatusChart,
  MarketplaceTopProductsTable,
} from "@/components/shared";

export default function LazadaOverview() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const queryClient = useQueryClient();

  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().split("T")[0] || "";

  const [dateFrom, setDateFrom] = useState<string | null>(defaultFrom);
  const [dateTo, setDateTo] = useState<string | null>(defaultTo);

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data: shops, isLoading: shopsLoading } = useQuery({
    queryKey: ["lazada", "shops"],
    queryFn: async () => {
      const response = await apiClient.lazada.getShops();
      return response.data;
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["lazada", "stats", dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.lazada.getStats(
        undefined,
        dateFrom || undefined,
        dateTo || undefined,
      );
      return response.data;
    },
    enabled: !!shops && shops.length > 0,
  });

  const syncMutation = useMutation({
    mutationFn: async (sellerId: string) => {
      const response = await apiClient.lazada.triggerSync({
        sellerId,
        syncType: "all",
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lazada"] });
    },
  });

  const handleConnect = async () => {
    try {
      const response = await apiClient.lazada.getAuthUrl();
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error("Failed to get auth URL:", error);
    }
  };

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lazada Integration</h1>
          <p className="text-muted-foreground">
            Manage your Lazada sellers and sync products & orders
          </p>
        </div>
        <Button onClick={handleConnect}>
          <LinkIcon className="mr-2 h-4 w-4" />
          Connect Lazada Seller
        </Button>
      </div>

      {shopsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : shops && shops.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shops.map((shop: { id: string; sellerId: string; sellerName: string; countryCode: string | null; lastSyncedAt: string | null }) => (
            <Card key={shop.id} className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Store className="h-4 w-4 text-blue-500" />
                  {shop.sellerName}
                </CardTitle>
                <Badge variant="default">Connected</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Seller ID: {shop.sellerId}</p>
                  <p>Country: {shop.countryCode?.toUpperCase()}</p>
                  {shop.lastSyncedAt && (
                    <p>Last synced: {new Date(shop.lastSyncedAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncMutation.mutate(shop.sellerId)}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleConnect}
                    title="Re-authorize tokens"
                  >
                    <KeyRound className="mr-1 h-3 w-3" />
                    Re-authorize
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/lazada/products?sellerId=${shop.sellerId}`}>
                      <Package className="mr-1 h-3 w-3" />
                      Products
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/lazada/orders?sellerId=${shop.sellerId}`}>
                      <ShoppingCart className="mr-1 h-3 w-3" />
                      Orders
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Lazada Sellers Connected</h3>
            <p className="text-muted-foreground text-center mb-4">
              Connect your Lazada seller account to start syncing products and orders
            </p>
            <Button onClick={handleConnect}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Connect Your First Seller
            </Button>
          </CardContent>
        </Card>
      )}

      {shops && shops.length > 0 && (
        <>
          <MarketplaceDateRangeFilter
            onDateRangeChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
            initialFrom={dateFrom}
            initialTo={dateTo}
          />

          {stats && (
            <MarketplaceStatsCards stats={stats} titlePrefix="Lazada" />
          )}

          <MarketplaceRevenueTrendChart
            dateFrom={dateFrom}
            dateTo={dateTo}
            accentColor="#10b981"
            queryKey={["lazada", "revenue-trend"]}
            fetchFunction={async (granularity, from, to) => {
              const response = await apiClient.lazada.getRevenueTrend(
                granularity,
                undefined,
                from,
                to,
              );
              return { data: response.data.data };
            }}
          />

          {stats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MarketplaceOrderStatusChart data={stats.ordersByStatus} />
              <MarketplaceTopProductsTable data={stats.topProducts} />
            </div>
          )}
        </>
      )}

      {shops && shops.length > 0 && (
        <div className="flex gap-4">
          <Button variant="outline" asChild>
            <Link href="/admin/lazada/sync-history">
              <History className="mr-2 h-4 w-4" />
              View Sync History
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
