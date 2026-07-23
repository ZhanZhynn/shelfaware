"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, Package, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/money";

interface ProductPerformance {
  id: string;
  shopeeItemId: number;
  itemName: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  quantitySold30d: number;
  revenue30d: number;
  dailySalesRate: number;
  daysUntilStockout: number | null;
  stockTurnover: number | null;
  isSlowMoving: boolean;
  isOutOfStock: boolean;
  isLowStock: boolean;
  performanceRating: string;
}

const RATING_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  excellent: "success",
  good: "success",
  average: "warning",
  slow: "secondary",
  dead: "destructive",
};

const RATING_LABELS: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  average: "Average",
  slow: "Slow",
  dead: "Dead",
};

export default function ShopeeProductPerformance() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const limit = 10;

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "product-performance"],
    queryFn: async () => {
      const response = await apiClient.shopee.getProductPerformance();
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ProductPerformance>[]>(
    () => [
      {
        accessorKey: "imageUrl",
        header: "",
        cell: ({ row }) => (
          <div className="h-8 w-8 rounded bg-muted flex items-center justify-center overflow-hidden">
            {row.original.imageUrl ? (
              <img src={row.original.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "itemName",
        header: "Product",
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.itemName}</span>
        ),
      },
      {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }) => {
          const threshold = data?.lowStockThreshold ?? 10;
          const variant =
            row.original.isOutOfStock
              ? ("destructive" as const)
              : row.original.stock < threshold
                ? ("warning" as const)
                : ("success" as const);
          return <Badge variant={variant}>{row.original.stock}</Badge>;
        },
      },
      {
        accessorKey: "quantitySold30d",
        header: "Sold (30d)",
        cell: ({ row }) => <span>{row.original.quantitySold30d}</span>,
      },
      {
        accessorKey: "dailySalesRate",
        header: "Daily Rate",
        cell: ({ row }) => <span>{row.original.dailySalesRate}/day</span>,
      },
      {
        accessorKey: "daysUntilStockout",
        header: "Stockout In",
        cell: ({ row }) => (
          <span className={row.original.daysUntilStockout !== null && row.original.daysUntilStockout < 7 ? "text-destructive font-medium" : ""}>
            {row.original.daysUntilStockout !== null ? `${row.original.daysUntilStockout}d` : "N/A"}
          </span>
        ),
      },
      {
        accessorKey: "revenue30d",
        header: "Revenue (30d)",
        cell: ({ row }) => <span className="font-medium">{formatMoney(row.original.revenue30d, "MYR")}</span>,
      },
      {
        accessorKey: "performanceRating",
        header: "Rating",
        cell: ({ row }) => (
          <Badge variant={RATING_COLORS[row.original.performanceRating]}>
            {RATING_LABELS[row.original.performanceRating]}
          </Badge>
        ),
      },
    ],
    [],
  );

  const allProducts: ProductPerformance[] = data?.products || [];
  const totalPages = Math.ceil(allProducts.length / limit);
  const paginatedData = allProducts.slice((page - 1) * limit, page * limit);

  const table = useReactTable({
    data: paginatedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const summary = data?.summary || { totalProducts: 0, lowStock: 0, outOfStock: 0, slowMoving: 0 };

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Package className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Products</p>
                <p className="text-lg font-bold">{summary.totalProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Out of Stock</p>
                <p className="text-lg font-bold text-red-500">{summary.outOfStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className="text-lg font-bold text-amber-500">{summary.lowStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-500/10">
                <TrendingUp className="h-4 w-4 text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Slow Moving</p>
                <p className="text-lg font-bold">{summary.slowMoving}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Table */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Product Performance (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b">
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                        No product data available
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 text-sm">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
