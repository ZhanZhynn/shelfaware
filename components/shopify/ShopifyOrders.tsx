"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MarketplaceDataTable } from "@/components/shared";

interface ShopifyOrderRow {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  orderStatus: string;
  financialStatus: string | null;
  totalAmount: number;
  currency: string;
  createdAt: string | null;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  open: "warning",
  closed: "success",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
};

export default function ShopifyOrders() {
  const searchParams = useSearchParams();
  const shopIdParam = searchParams.get("shopId") || undefined;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["shopify", "orders", shopIdParam, page],
    queryFn: async () => {
      const response = await apiClient.shopify.getOrders({
        shopId: shopIdParam,
        page,
        limit,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ShopifyOrderRow>[]>(
    () => [
      {
        accessorKey: "orderName",
        header: "Order #",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.orderName}</span>
        ),
      },
      {
        accessorKey: "orderStatus",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_COLORS[row.original.orderStatus] || "default"}>
            {STATUS_LABELS[row.original.orderStatus] || row.original.orderStatus}
          </Badge>
        ),
      },
      {
        accessorKey: "financialStatus",
        header: "Payment",
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.financialStatus || "—"}
          </Badge>
        ),
      },
      {
        id: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.totalAmount.toFixed(2)} {row.original.currency}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.createdAt
              ? new Date(row.original.createdAt).toLocaleDateString()
              : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => (data?.orders || []) as ShopifyOrderRow[], [data]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
          <h1 className="text-2xl font-bold">Shopify Orders</h1>
        </div>
      </div>

      <MarketplaceDataTable
        table={table}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        totalCount={data?.total}
        countLabel="orders"
        emptyStateTitle="No orders found"
        emptyStateDescription="Sync your Shopify store to see orders here"
        emptyStateIcon={ShoppingCart}
        columnCount={columns.length}
      />
    </div>
  );
}
