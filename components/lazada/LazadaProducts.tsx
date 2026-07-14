"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type Row,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MarketplaceDataTable, VariantSubTable } from "@/components/shared";

interface LazadaProductRow {
  id: string;
  lazadaItemId: number;
  itemName: string;
  sellerSku: string | null;
  status: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  variants?: Array<{
    id?: string;
    skuId?: number;
    sellerSku?: string | null;
    shopSku?: string | null;
    variation?: string | null;
    price: number;
    specialPrice?: number | null;
    stock: number;
    available?: number | null;
    status?: string;
    images?: unknown;
  }>;
}

function renderLazadaVariants(row: Row<LazadaProductRow>) {
  return <VariantSubTable variants={row.original.variants || []} marketplace="lazada" />;
}

export default function LazadaProducts() {
  const searchParams = useSearchParams();
  const sellerIdParam = searchParams.get("sellerId") || undefined;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["lazada", "products", sellerIdParam, page, search],
    queryFn: async () => {
      const response = await apiClient.lazada.getProducts({
        sellerId: sellerIdParam,
        page,
        limit,
        search: search || undefined,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<LazadaProductRow>[]>(
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
        accessorKey: "sellerSku",
        header: "SKU",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-sm">
            {row.original.sellerSku || "N/A"}
          </span>
        ),
      },
      {
        accessorKey: "lazadaItemId",
        header: "Item ID",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-sm">
            {row.original.lazadaItemId}
          </span>
        ),
      },
      {
        accessorKey: "price",
        header: "Price",
        cell: ({ row }) => (
          <span className="font-medium">RM {row.original.price.toFixed(2)}</span>
        ),
      },
      {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.stock === 0
                ? "destructive"
                : row.original.stock < 10
                  ? "warning"
                  : "success"
            }
          >
            {row.original.stock}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "success" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => (data?.products || []) as LazadaProductRow[], [data]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
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
          <Link href="/admin/lazada">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Lazada Products</h1>
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
        emptyStateDescription={search ? "No products match your search" : "Sync your Lazada seller to see products here"}
        emptyStateIcon={Package}
        columnCount={columns.length}
        renderExpandedRow={renderLazadaVariants}
      />
    </div>
  );
}
