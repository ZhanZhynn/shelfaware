"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock } from "lucide-react";

interface SyncLogRow {
  id: string;
  syncType: string;
  status: string;
  itemsSynced: number;
  itemsCreated: number;
  itemsUpdated: number;
  errors: string[] | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <Clock className="h-4 w-4 text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  completed_with_errors: <CheckCircle className="h-4 w-4 text-yellow-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  running: "secondary",
  completed: "success",
  completed_with_errors: "warning",
  failed: "destructive",
};

export default function ShopeeSyncHistory() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    queueMicrotask(() => {
      mounted.current = true;
      setIsMounted(true);
    });
  }, []);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["shopee", "sync-logs"],
    queryFn: async () => {
      const response = await apiClient.shopee.getSyncLogs();
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<SyncLogRow>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {STATUS_ICONS[row.original.status]}
            <Badge variant={STATUS_VARIANTS[row.original.status] || "default"}>
              {row.original.status.replace("_", " ")}
            </Badge>
          </div>
        ),
      },
      {
        accessorKey: "syncType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.syncType}
          </Badge>
        ),
      },
      {
        accessorKey: "itemsSynced",
        header: "Synced",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.itemsSynced}</span>
        ),
      },
      {
        accessorKey: "itemsCreated",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-green-600">+{row.original.itemsCreated}</span>
        ),
      },
      {
        accessorKey: "itemsUpdated",
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-blue-600">~{row.original.itemsUpdated}</span>
        ),
      },
      {
        accessorKey: "triggeredBy",
        header: "Triggered By",
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize">
            {row.original.triggeredBy}
          </Badge>
        ),
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.original.startedAt).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "completedAt",
        header: "Duration",
        cell: ({ row }) => {
          if (!row.original.completedAt) return <span className="text-muted-foreground">—</span>;
          const duration = Math.round(
            (new Date(row.original.completedAt).getTime() - new Date(row.original.startedAt).getTime()) / 1000,
          );
          return <span className="text-sm">{duration}s</span>;
        },
      },
      {
        accessorKey: "errors",
        header: "Errors",
        cell: ({ row }) => {
          if (!row.original.errors || row.original.errors.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Badge variant="destructive">
              {row.original.errors.length} error{row.original.errors.length > 1 ? "s" : ""}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  const paginatedData = useMemo(() => {
    if (!logs) return [];
    const start = (page - 1) * limit;
    return logs.slice(start, start + limit);
  }, [logs, page]);

  const table = useReactTable({
    data: paginatedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const totalPages = logs ? Math.ceil(logs.length / limit) : 0;

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
        <h1 className="text-2xl font-bold">Sync History</h1>
      </div>

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
                        No sync history found
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
