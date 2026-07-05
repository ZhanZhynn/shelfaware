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
import { ChevronLeft, ChevronRight, RotateCcw, DollarSign, Package, AlertTriangle } from "lucide-react";

interface ReturnData {
  id: string;
  returnSn: string;
  orderSn: string;
  status: string;
  refundAmount: number;
  currency: string | null;
  reason: string | null;
  textReason: string | null;
  buyerUsername: string | null;
  shopeeCreatedAt: string | null;
  needsLogistics: boolean;
}

const STATUS_BADGES: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  REQUESTED: "warning",
  PROCESSING: "secondary",
  ACCEPTED: "default",
  COMPLETED: "success",
  CANCELLED: "outline",
};

export default function ShopeeReturns() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const limit = 20;

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["shopee", "returns", page, statusFilter],
    queryFn: async () => {
      const response = await apiClient.shopee.getReturns({
        page,
        limit,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      return response.data;
    },
    enabled: isMounted,
  });

  const columns = useMemo<ColumnDef<ReturnData>[]>(
    () => [
      {
        accessorKey: "returnSn",
        header: "Return #",
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.returnSn}</span>
        ),
      },
      {
        accessorKey: "orderSn",
        header: "Order #",
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">{row.original.orderSn}</span>
        ),
      },
      {
        accessorKey: "buyerUsername",
        header: "Buyer",
        cell: ({ row }) => <span>{row.original.buyerUsername || "—"}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGES[row.original.status] || "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "refundAmount",
        header: "Refund",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.currency || "RM"} {row.original.refundAmount.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
            {row.original.reason || "—"}
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
              : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const returns: ReturnData[] = (data?.returns ?? []) as unknown as ReturnData[];
  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const table = useReactTable({
    data: returns,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shopee Returns</h1>
          <p className="text-muted-foreground">Track return/refund requests from buyers</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["all", "REQUESTED", "PROCESSING", "ACCEPTED", "COMPLETED", "CANCELLED"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : returns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <RotateCcw className="h-10 w-10 mb-3" />
              <p className="font-medium">No returns found</p>
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
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 text-sm">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
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
            Page {page} of {totalPages} · {data?.total || 0} returns
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
