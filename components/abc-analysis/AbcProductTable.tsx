"use client";

import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { AbcProduct } from "@/types/abc-analysis";
import { formatMoney } from "@/lib/money";

function formatCurrency(value: number): string {
  return formatMoney(value, "MYR");
}

const tierVariant: Record<string, "success" | "warning" | "destructive"> = {
  A: "success",
  B: "warning",
  C: "destructive",
};

function SortableHeader({ label, onClick, isSorted, isDesc }: { label: string; onClick: () => void; isSorted?: boolean; isDesc?: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 hover:text-foreground">
      {label}
      {isSorted ? (isDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
    </button>
  );
}

export default function AbcProductTable({ products }: { products: AbcProduct[] }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "A" | "B" | "C">("all");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  const filteredData = useMemo(() => {
    return products.filter((p) => {
      const searchMatch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
      const tierMatch = tierFilter === "all" || p.tier === tierFilter;
      return searchMatch && tierMatch;
    });
  }, [products, search, tierFilter]);

  const columns: ColumnDef<AbcProduct>[] = useMemo(
    () => [
      { accessorKey: "tier", header: ({ column }) => <SortableHeader label="Tier" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, cell: ({ row }) => <Badge variant={tierVariant[row.original.tier]}>{row.original.tier}</Badge>, size: 60 },
      { accessorKey: "name", header: ({ column }) => <SortableHeader label="Product" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} /> },
      { accessorKey: "sku", header: "SKU", size: 100 },
      { accessorKey: "revenue", header: ({ column }) => <SortableHeader label="Revenue" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, cell: ({ row }) => formatCurrency(row.original.revenue) },
      { accessorKey: "revenuePercent", header: ({ column }) => <SortableHeader label="%" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, cell: ({ row }) => `${row.original.revenuePercent.toFixed(1)}%`, size: 70 },
      { accessorKey: "unitsSold", header: ({ column }) => <SortableHeader label="Units" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, size: 80 },
      { accessorKey: "stockOnHand", header: ({ column }) => <SortableHeader label="Stock" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, size: 80 },
      { accessorKey: "holdingValue", header: ({ column }) => <SortableHeader label="Holding" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, cell: ({ row }) => formatCurrency(row.original.holdingValue) },
      { accessorKey: "daysOfStock", header: ({ column }) => <SortableHeader label="Days" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} isSorted={!!column.getIsSorted()} isDesc={column.getIsSorted() === "desc"} />, cell: ({ row }) => row.original.daysOfStock !== null ? `${row.original.daysOfStock}d` : "N/A", size: 60 },
      { accessorKey: "channel", header: "Channel", size: 80, cell: ({ row }) => <Badge variant="outline" className="text-xs">{row.original.channel}</Badge> },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { pagination, sorting: [] },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-sm font-medium">Products by ABC Tier</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs w-[150px]"
              />
            </div>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as typeof tierFilter)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="all">All Tiers</option>
              <option value="A">A Items</option>
              <option value="B">B Items</option>
              <option value="C">C Items</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                    No products found.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="text-xs">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-2 py-3">
          <span className="text-xs text-muted-foreground">
            {filteredData.length} products
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2">
              {pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
