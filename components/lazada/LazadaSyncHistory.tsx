"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Clock, History, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { MarketplaceDataTable } from "@/components/shared";

interface LazadaSyncLogRow {
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
  completed_with_errors: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  running: "secondary",
  completed: "success",
  completed_with_errors: "warning",
  failed: "destructive",
};

export default function LazadaSyncHistory() {
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
    queryKey: ["lazada", "sync-logs"],
    queryFn: async () => {
      const response = await apiClient.lazada.getSyncLogs();
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<LazadaSyncLogRow>[]>(
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
          if (!row.original.completedAt) return <span className="text-muted-foreground">{"\u2014"}</span>;
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
            return <span className="text-muted-foreground">{"\u2014"}</span>;
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/lazada">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Lazada Sync History</h1>
          <p className="text-muted-foreground">View recent synchronization logs</p>
        </div>
      </div>

      <MarketplaceDataTable
        table={table}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyStateTitle="No sync history found"
        emptyStateDescription="Sync your Lazada seller to see history here"
        emptyStateIcon={History}
        columnCount={columns.length}
      />
    </div>
  );
}
