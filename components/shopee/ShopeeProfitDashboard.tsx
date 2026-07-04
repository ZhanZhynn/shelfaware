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
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingDown, ChevronLeft, ChevronRight } from "lucide-react";

interface ProfitSummary {
  totalRevenue: number;
  totalCommission: number;
  totalServiceFee: number;
  totalSellerTxnFee: number;
  totalShippingFee: number;
  totalSellerIncome: number;
  totalFees: number;
  overallMargin: number;
  totalOrders: number;
  avgOrderValue: number;
  avgFeePerOrder: number;
}

interface ProfitByProduct {
  productName: string;
  revenue: number;
  quantitySold: number;
  orderCount: number;
  estimatedFees: number;
  estimatedProfit: number;
  margin: number;
}

interface FeeBreakdown {
  name: string;
  amount: number;
  percentage: number;
}

const FEE_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#8b5cf6"];

export default function ShopeeProfitDashboard() {
  const mounted = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
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
    queryKey: ["shopee", "profit"],
    queryFn: async () => {
      const response = await apiClient.shopee.getProfitData();
      return response.data;
    },
  });

  const columns = useMemo<ColumnDef<ProfitByProduct>[]>(
    () => [
      {
        accessorKey: "productName",
        header: "Product",
        cell: ({ row }) => <span className="font-medium text-sm">{row.original.productName}</span>,
      },
      {
        accessorKey: "revenue",
        header: "Revenue",
        cell: ({ row }) => <span>${row.original.revenue.toFixed(2)}</span>,
      },
      {
        accessorKey: "quantitySold",
        header: "Qty Sold",
        cell: ({ row }) => <span>{row.original.quantitySold}</span>,
      },
      {
        accessorKey: "estimatedFees",
        header: "Est. Fees",
        cell: ({ row }) => <span className="text-destructive">-${row.original.estimatedFees.toFixed(2)}</span>,
      },
      {
        accessorKey: "estimatedProfit",
        header: "Est. Profit",
        cell: ({ row }) => (
          <span className={row.original.estimatedProfit >= 0 ? "text-emerald-500 font-medium" : "text-destructive font-medium"}>
            ${row.original.estimatedProfit.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "margin",
        header: "Margin",
        cell: ({ row }) => (
          <span className={row.original.margin >= 0 ? "text-emerald-500" : "text-destructive"}>
            {row.original.margin.toFixed(1)}%
          </span>
        ),
      },
    ],
    [],
  );

  const summary: ProfitSummary = data?.summary || {
    totalRevenue: 0,
    totalCommission: 0,
    totalServiceFee: 0,
    totalSellerTxnFee: 0,
    totalShippingFee: 0,
    totalSellerIncome: 0,
    totalFees: 0,
    overallMargin: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    avgFeePerOrder: 0,
  };

  const allProducts: ProfitByProduct[] = data?.byProduct || [];
  const feeBreakdown: FeeBreakdown[] = data?.feeBreakdown || [];
  const totalPages = Math.ceil(allProducts.length / limit);
  const paginatedData = allProducts.slice((page - 1) * limit, page * limit);

  const table = useReactTable({
    data: paginatedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  if (!isMounted) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="text-lg font-bold">${summary.totalRevenue.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <TrendingDown className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Fees</p>
                <p className="text-lg font-bold text-red-500">${summary.totalFees.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <DollarSign className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Seller Income</p>
                <p className="text-lg font-bold">${summary.totalSellerIncome.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingDown className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overall Margin</p>
                <p className="text-lg font-bold">{summary.overallMargin.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fee Breakdown Chart + Profit Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fee Breakdown Pie Chart */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Fee Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {feeBreakdown.every((f) => f.amount === 0) ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No fee data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={feeBreakdown.filter((f) => f.amount > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="amount"
                    nameKey="name"
                  >
                    {feeBreakdown
                      .filter((f) => f.amount > 0)
                      .map((_, index) => (
                        <Cell key={`cell-${index}`} fill={FEE_COLORS[index % FEE_COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(2)}`, "Amount"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
            {/* Fee breakdown list */}
            <div className="space-y-2 mt-4">
              {feeBreakdown.map((fee) => (
                <div key={fee.name} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{fee.name}</span>
                  <span>${fee.amount.toFixed(2)} ({fee.percentage.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Profit by Product Table */}
        <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Profit by Product</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
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
                    {table.getRowModel().rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                          No product profit data available
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
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
