"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Package, Search, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function LazadaProducts() {
  const searchParams = useSearchParams();
  const sellerIdParam = searchParams.get("sellerId") || undefined;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["lazada", "products", sellerIdParam, page, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (sellerIdParam) params.set("sellerId", sellerIdParam);
      if (search) params.set("search", search);

      const res = await fetch(`/api/lazada/products?${params}`);
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/lazada">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Lazada Products</h1>
          <p className="text-muted-foreground">
            {data ? `${data.total} products` : "Loading..."}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Product List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : data?.products?.length > 0 ? (
        <div className="space-y-4">
          {data.products.map((product: { id: string; lazadaItemId: number; itemName: string; sellerSku: string | null; status: string; price: number; stock: number; imageUrl: string | null }) => (
            <Card key={product.id}>
              <CardContent className="flex items-center gap-4 py-4">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.itemName}
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center">
                    <Package className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.itemName}</p>
                  <p className="text-sm text-muted-foreground">
                    SKU: {product.sellerSku || "N/A"} | Item ID: {product.lazadaItemId}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">RM {product.price.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">Stock: {product.stock}</p>
                </div>
                <Badge variant={product.status === "active" ? "default" : "secondary"}>
                  {product.status}
                </Badge>
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">
                Page {page} of {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Products Found</h3>
            <p className="text-muted-foreground text-center">
              {search ? "No products match your search" : "Sync your Lazada seller to see products here"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
