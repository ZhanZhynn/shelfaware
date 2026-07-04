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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

interface ShopeeOrderRow {
  id: string;
  shopeeOrderId: string;
  orderStatus: string;
  paymentStatus: string | null;
  totalAmount: number;
  currency: string | null;
  buyerUsername: string | null;
  trackingNumber: string | null;
  shopeeCreatedAt: string | null;
  items: { productName: string; quantity: number }[];
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  UNPAID: "warning",
  READY_TO_SHIP: "warning",
  PROCESSED: "warning",
  SHIPPED: "outline",
  COMPLETED: "success",
  CANCELLED: "destructive",
  INVOICE_PENDING: "warning",
};

const STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  READY_TO_SHIP: "Ready to Ship",
  PROCESSED: "Processed",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  INVOICE_PENDING: "Invoice Pending",
};

export default function ShopeeOrders() {
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shopId") || undefined;

  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
    queryKey: ["shopee", "orders", page, statusFilter, shopId],
    queryFn: async () => {
      const response = await apiClient.shopee.getOrders({
        page,
        limit,
        status: statusFilter === "all" ? undefined : statusFilter,
        shopId,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ShopeeOrderRow>[]>(
    () => [
      {
        accessorKey: "shopeeOrderId",
        header: "Order #",
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.shopeeOrderId}</span>
        ),
      },
      {
        accessorKey: "buyerUsername",
        header: "Buyer",
        cell: ({ row }) => (
          <span>{row.original.buyerUsername || "N/A"}</span>
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
        accessorKey: "totalAmount",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.currency || "$"}{row.original.totalAmount.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "items",
        header: "Items",
        cell: ({ row }) => (
          <span>{row.original.items?.length || 0} items</span>
        ),
      },
      {
        accessorKey: "trackingNumber",
        header: "Tracking",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.trackingNumber || "—"}
          </span>
        ),
      },
      {
        accessorKey: "shopeeCreatedAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.shopeeCreatedAt
              ? new Date(row.original.shopeeCreatedAt).toLocaleDateString()
              : "N/A"}
          </span>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => data?.orders || [], [data]);

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
        <h1 className="text-2xl font-bold">Shopee Orders</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {data?.total || 0} orders
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
                        No orders found
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
