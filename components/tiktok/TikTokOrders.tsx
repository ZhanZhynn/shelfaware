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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShoppingCart, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MarketplaceDataTable } from "@/components/shared";

interface TikTokOrderRow {
  id: string;
  tiktokOrderId: string;
  orderStatus: string;
  buyerNickname: string | null;
  totalAmount?: number;
  payment?: Record<string, unknown>;
  tiktokCreatedAt: string | null;
  items: Array<{ productName: string; quantity: number; price: number }>;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  pending: "warning",
  confirmed: "outline",
  processing: "outline",
  shipped: "outline",
  delivered: "success",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export default function TikTokOrders() {
  const searchParams = useSearchParams();
  const shopIdParam = searchParams.get("shopId") || undefined;

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([]);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["tiktok", "orders", shopIdParam, page, statusFilter],
    queryFn: async () => {
      const response = await apiClient.tiktok.getOrders({
        shopId: shopIdParam,
        page,
        limit,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<TikTokOrderRow>[]>(
    () => [
      {
        accessorKey: "tiktokOrderId",
        header: "Order #",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.tiktokOrderId}
          </span>
        ),
      },
      {
        accessorKey: "buyerNickname",
        header: "Customer",
        cell: ({ row }) => (
          <span>{row.original.buyerNickname || "N/A"}</span>
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
        id: "total",
        header: "Total",
        accessorFn: (row: TikTokOrderRow) => {
          const payment = row.payment as Record<string, unknown> | undefined;
          return payment ? Number(payment.total_amount ?? payment.sub_total ?? 0) : 0;
        },
        cell: ({ getValue }) => (
          <span className="font-medium">
            {Number(getValue()).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "items",
        header: "Items",
        cell: ({ row }) => {
          const items = row.original.items || [];
          return (
            <div className="text-sm">
              <span>{items.length} item{items.length !== 1 ? "s" : ""}</span>
              {items.length > 0 && (
                <span className="text-muted-foreground ml-1">
                  ({items.slice(0, 2).map((i) => i.productName).join(", ")}
                  {items.length > 2 ? ` +${items.length - 2} more` : ""})
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "tiktokCreatedAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.tiktokCreatedAt
              ? new Date(row.original.tiktokCreatedAt).toLocaleDateString()
              : "N/A"}
          </span>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => (data?.orders || []) as TikTokOrderRow[], [data]);

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
          <Link href="/admin/tiktok">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">TikTok Orders</h1>
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
        emptyStateDescription={statusFilter !== "all" ? `No orders with status "${statusFilter}"` : "Sync your TikTok Shop to see orders here"}
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
