"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingBag,
  LinkIcon,
  RefreshCw,
  Package,
  ShoppingCart,
} from "lucide-react";
import ShopeeStatsCards from "./ShopeeStatsCards";
import ShopeeOrderStatusChart from "./ShopeeOrderStatusChart";
import ShopeeTopProductsChart from "./ShopeeTopProductsChart";
import ShopeeRevenueTrendChart from "./ShopeeRevenueTrendChart";
import ShopeeSlaAlertWidget from "./ShopeeSlaAlertWidget";

export default function ShopeeOverview() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data: shops, isLoading: shopsLoading } = useQuery({
    queryKey: ["shopee", "shops"],
    queryFn: async () => {
      const response = await apiClient.shopee.getShops();
      return response.data;
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["shopee", "stats"],
    queryFn: async () => {
      const response = await apiClient.shopee.getStats();
      return response.data;
    },
    enabled: !!shops && shops.length > 0,
  });

  const syncMutation = useMutation({
    mutationFn: async (data: { shopId: number; syncType: "all" }) => {
      const response = await apiClient.shopee.triggerSync(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopee"] });
    },
  });

  const handleConnect = async () => {
    try {
      const response = await apiClient.shopee.getAuthUrl();
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error("Failed to get auth URL:", error);
    }
  };

  const handleSync = (shopId: number) => {
    syncMutation.mutate({ shopId, syncType: "all" });
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
          <h1 className="text-2xl font-bold">Shopee Integration</h1>
          <p className="text-muted-foreground">
            Manage your Shopee stores and sync products & orders
          </p>
        </div>
        <Button onClick={handleConnect}>
          <LinkIcon className="mr-2 h-4 w-4" />
          Connect Shopee Store
        </Button>
      </div>

      {/* Connected Shops */}
      {shopsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : shops && shops.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shops.map((shop) => (
            <Card key={shop.id} className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-orange-500" />
                  {shop.shopName}
                </CardTitle>
                <Badge variant={shop.shopStatus === "active" ? "default" : "secondary"}>
                  {shop.shopStatus}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Shop ID: {shop.shopId}</p>
                  <p>Region: {shop.region}</p>
                  {shop.lastSyncedAt && (
                    <p>Last synced: {new Date(shop.lastSyncedAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(shop.shopId)}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    Sync
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`/admin/shopee/products?shopId=${shop.shopId}`}>
                      <Package className="mr-1 h-3 w-3" />
                      Products
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`/admin/shopee/orders?shopId=${shop.shopId}`}>
                      <ShoppingCart className="mr-1 h-3 w-3" />
                      Orders
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Shopee Stores Connected</h3>
            <p className="text-muted-foreground text-center mb-4">
              Connect your Shopee store to start syncing products and orders
            </p>
            <Button onClick={handleConnect}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Connect Your First Store
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SLA Alert Widget */}
      {shops && shops.length > 0 && <ShopeeSlaAlertWidget />}

      {/* Stats and Charts */}
      {shops && shops.length > 0 && stats && (
        <>
          <ShopeeStatsCards stats={stats} />
          <ShopeeRevenueTrendChart />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ShopeeOrderStatusChart data={stats.ordersByStatus} />
            <ShopeeTopProductsChart data={stats.topProducts} />
          </div>
        </>
      )}
    </div>
  );
}
