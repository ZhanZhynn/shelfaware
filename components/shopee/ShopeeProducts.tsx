"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronLeft, ChevronRight, Package } from "lucide-react";

interface ShopeeProductRow {
  id: string;
  shopeeItemId: number;
  itemName: string;
  price: number;
  originalPrice: number | null;
  stock: number;
  status: string;
  imageUrl: string | null;
  lastSyncedAt: string | null;
}

export default function ShopeeProducts() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shopId") || undefined;

  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [search, setSearch] = useState("");
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
    queryKey: ["shopee", "products", page, search, shopId],
    queryFn: async () => {
      const response = await apiClient.shopee.getProducts({
        page,
        limit,
        search: search || undefined,
        shopId,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ShopeeProductRow>[]>(
    () => [
      {
        accessorKey: "imageUrl",
        header: "Image",
        cell: ({ row }) => (
          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center overflow-hidden">
            {row.original.imageUrl ? (
              <img src={row.original.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "itemName",
        header: "Product Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.itemName}</span>
        ),
      },
      {
        accessorKey: "shopeeItemId",
        header: "Item ID",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-sm">{row.original.shopeeItemId}</span>
        ),
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => {
          const price = row.original.price;
          const originalPrice = row.original.originalPrice;
          return (
            <div className="flex flex-col">
              <span className="font-medium">${price.toFixed(2)}</span>
              {originalPrice && originalPrice > price && (
                <span className="text-xs text-muted-foreground line-through">
                  ${originalPrice.toFixed(2)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }) => (
          <Badge variant={row.original.stock === 0 ? "destructive" : row.original.stock < 10 ? "secondary" : "default"}>
            {row.original.stock}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "NORMAL" ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "lastSyncedAt",
        header: "Last Synced",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastSyncedAt
              ? new Date(row.original.lastSyncedAt).toLocaleDateString()
              : "Never"}
          </span>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => (data?.products || []) as ShopeeProductRow[], [data]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shopee Products</h1>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {data?.total || 0} products
        </span>
      </div>

      {/* Table */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b">
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-4 py-3 text-left text-sm font-medium text-muted-foreground"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                        No products found
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
