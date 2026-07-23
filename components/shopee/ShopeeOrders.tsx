"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShoppingCart } from "lucide-react";
import { MarketplaceDataTable } from "@/components/shared";

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
            {formatMoney(row.original.totalAmount, row.original.currency || "MYR")}
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
            {row.original.trackingNumber || "\u2014"}
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

      <MarketplaceDataTable
        table={table}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        totalCount={data?.total}
        countLabel="orders"
        emptyStateTitle="No orders found"
        emptyStateIcon={ShoppingCart}
        columnCount={columns.length}
        headerActions={
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
        }
      />
    </div>
  );
}
