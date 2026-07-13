"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Store,
  LinkIcon,
  RefreshCw,
  Package,
  ShoppingCart,
  History,
  KeyRound,
  ShoppingBag,
  ExternalLink,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import Link from "next/link";

interface ShopifyShop {
  id: string;
  shopDomain: string;
  shopName: string;
  scopes: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export default function ShopifyOverview() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [shopDomainInput, setShopDomainInput] = useState("");
  const [shopDomainError, setShopDomainError] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data: shops, isLoading: shopsLoading } = useQuery<ShopifyShop[]>({
    queryKey: ["shopify", "shops"],
    queryFn: async () => {
      const response = await apiClient.shopify.getShops();
      return response.data;
    },
  });

  const { data: productsData } = useQuery({
    queryKey: ["shopify", "products", "count"],
    queryFn: async () => {
      const response = await apiClient.shopify.getProducts({ limit: 1 });
      return response.data ?? { total: 0 };
    },
    enabled: !!shops && shops.length > 0,
  });

  const { data: ordersData } = useQuery({
    queryKey: ["shopify", "orders", "count"],
    queryFn: async () => {
      const response = await apiClient.shopify.getOrders({ limit: 1 });
      return response.data ?? { total: 0 };
    },
    enabled: !!shops && shops.length > 0,
  });

  const syncMutation = useMutation({
    mutationFn: async (shopId: string) => {
      const response = await apiClient.shopify.triggerSync({ shopId, syncType: "all" });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopify"] });
    },
  });

  const validateShopDomain = (domain: string): boolean => {
    return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
  };

  const handleConnect = async () => {
    setShopDomainError("");
    const cleanDomain = shopDomainInput.trim().toLowerCase();
    if (!cleanDomain) {
      setShopDomainError("Please enter a store domain");
      return;
    }
    if (!validateShopDomain(cleanDomain)) {
      setShopDomainError("Domain must be in format: yourstore.myshopify.com");
      return;
    }
    try {
      const response = await apiClient.shopify.getAuthUrl(cleanDomain);
      if (response.data?.url) {
        setConnectDialogOpen(false);
        window.location.href = response.data.url;
      }
    } catch (error) {
      setShopDomainError(error instanceof Error ? error.message : "Failed to connect");
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
          <h1 className="text-2xl font-bold">Shopify Integration</h1>
          <p className="text-muted-foreground">
            Manage your Shopify store and sync products & orders
          </p>
        </div>
        <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <LinkIcon className="mr-2 h-4 w-4" />
              Connect Shopify Store
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Connect Shopify Store</DialogTitle>
              <DialogDescription>
                Enter your Shopify store domain to begin the OAuth flow. You will be redirected to Shopify to authorize the connection.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <label className="text-sm font-medium">Store Domain</label>
              <Input
                placeholder="yourstore.myshopify.com"
                value={shopDomainInput}
                onChange={(e) => setShopDomainInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
              {shopDomainError && (
                <p className="text-sm text-red-500">{shopDomainError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Example: mystore.myshopify.com
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConnect}>Continue</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
                  <ShoppingBag className="h-4 w-4 text-green-500" />
                  {shop.shopName}
                </CardTitle>
                <Badge variant="default">Connected</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-1">
                    Domain:{" "}
                    <a
                      href={`https://${shop.shopDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline flex items-center gap-1"
                    >
                      {shop.shopDomain}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  {shop.lastSyncedAt && (
                    <p>Last synced: {new Date(shop.lastSyncedAt).toLocaleDateString()}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncMutation.mutate(shop.id)}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    Sync
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/shopify/products?shopId=${shop.id}`}>
                      <Package className="mr-1 h-3 w-3" />
                      Products
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/admin/shopify/orders?shopId=${shop.id}`}>
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
            <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Shopify Stores Connected</h3>
            <p className="text-muted-foreground text-center mb-4">
              Connect your Shopify store account to start syncing products and orders
            </p>
            <Button onClick={() => setConnectDialogOpen(true)}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Connect Your First Store
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      {shops && shops.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Connected Stores</CardTitle>
              <Store className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{shops.length}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Products</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{productsData?.total ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{ordersData?.total ?? 0}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Links */}
      {shops && shops.length > 0 && (
        <div className="flex gap-4">
          <Button variant="outline" asChild>
            <Link href="/admin/shopify/sync-history">
              <History className="mr-2 h-4 w-4" />
              View Sync History
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
