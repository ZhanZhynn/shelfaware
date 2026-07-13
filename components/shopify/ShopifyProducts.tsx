"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MarketplaceDataTable } from "@/components/shared";

interface ShopifyProductRow {
  id: string;
  shopifyProductId: string;
  title: string;
  status: string;
  featuredImageUrl: string | null;
  variants: Array<{ price: number; inventoryQuantity: number }>;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  ACTIVE: "success",
  DRAFT: "secondary",
  ARCHIVED: "outline",
  UNLISTED: "warning",
};

export default function ShopifyProducts() {
  const searchParams = useSearchParams();
  const shopIdParam = searchParams.get("shopId") || undefined;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["shopify", "products", shopIdParam, page, search],
    queryFn: async () => {
      const response = await apiClient.shopify.getProducts({
        shopId: shopIdParam,
        page,
        limit,
        search: search || undefined,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ShopifyProductRow>[]>(
    () => [
      {
        accessorKey: "featuredImageUrl",
        header: "Image",
        cell: ({ row }) => (
          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center overflow-hidden">
            {row.original.featuredImageUrl ? (
              <img src={row.original.featuredImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "title",
        header: "Product Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.title}</span>
        ),
      },
      {
        accessorKey: "shopifyProductId",
        header: "Product ID",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">
            {row.original.shopifyProductId.split("/").pop()}
          </span>
        ),
      },
      {
        id: "price",
        header: "Price",
        cell: ({ row }) => {
          const firstVariant = row.original.variants?.[0];
          return (
            <span className="font-medium">
              {firstVariant?.price ? firstVariant.price.toFixed(2) : "N/A"}
            </span>
          );
        },
      },
      {
        id: "stock",
        header: "Stock",
        cell: ({ row }) => {
          const totalStock = row.original.variants?.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0) ?? 0;
          return (
            <Badge
              variant={
                totalStock === 0
                  ? "destructive"
                  : totalStock < 10
                    ? "warning"
                    : "success"
              }
            >
              {totalStock}
            </Badge>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_COLORS[row.original.status] || "default"}>
            {row.original.status}
          </Badge>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => (data?.products || []) as ShopifyProductRow[], [data]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/shopify">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Shopify Products</h1>
        </div>
      </div>

      <MarketplaceDataTable
        table={table}
        isLoading={isLoading}
        searchPlaceholder="Search products..."
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        totalCount={data?.total}
        countLabel="products"
        emptyStateTitle="No products found"
        emptyStateDescription={search ? "No products match your search" : "Sync your Shopify store to see products here"}
        emptyStateIcon={Package}
        columnCount={columns.length}
      />
    </div>
  );
}
