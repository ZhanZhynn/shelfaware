"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { MarketplaceFilters } from "../analytics/MarketplaceFilters";
import { MarketplaceStatus } from "../analytics/MarketplaceStatus";
import { financialReportingCurrency, fetchMarketplaceMetric, MarketplaceApiError, displayValue, filtersFromSearchParams, marketplaceUrlQuery, type MarketplaceFiltersValue, type MarketplaceMetricResponse, type MarketplaceShopOption, validateMarketplaceFilters, withDefaultMarketplaceShop } from "../analytics/marketplaceAnalyticsUi";
import { DollarSign, TrendingUp, Receipt, Percent } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ── Profit Detail types ─────────────────────────────────────────────────────

type ProfitDetailSummary = {
  totalRevenue: number;
  totalFees: number;
  totalShipping: number;
  sellerIncome: number;
  overallMargin: number;
  totalOrders: number;
  avgOrderValue: number;
  avgFeePerOrder: number;
};

type FeeBreakdownItem = { name: string; amount: number; percentage: number };

type ProductProfitRow = {
  productName: string;
  revenue: number;
  quantitySold: number;
  orderCount: number;
  estimatedFees: number;
  estimatedProfit: number;
  margin: number;
};

type ShippingDiscrepancyProduct = {
  productName: string;
  orderCount: number;
  totalEstimated: number;
  totalActual: number;
  avgDiscrepancy: number;
  discrepancyPct: number;
  totalRevenue: number;
  totalQuantity: number;
};

type ProfitDetailResponse = {
  summary: ProfitDetailSummary;
  feeBreakdown: FeeBreakdownItem[];
  byProduct: ProductProfitRow[];
  shippingDiscrepancy?: {
    summary: { totalOrders: number; ordersWithDiscrepancy: number; totalEstimated: number; totalActual: number; totalDiscrepancy: number };
    products: ShippingDiscrepancyProduct[];
  };
  coverage: { state: "ready" | "provisional" | "unavailable"; basis: string; exclusions: string[] };
  currency: string;
};

// ── Chart colors ────────────────────────────────────────────────────────────

const PIE_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

// ── Main dashboard ──────────────────────────────────────────────────────────

export function MarketplaceProfitDashboard({ platform, title }: { platform: MarketplacePlatform; title: string }) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const [draft, setDraft] = useState<MarketplaceFiltersValue>(() => filtersFromSearchParams(searchParams));
  const [applied, setApplied] = useState<MarketplaceFiltersValue>(() => filtersFromSearchParams(searchParams));
  const [filterError, setFilterError] = useState<string | null>(null);

  const shopsQuery = useQuery<{ shops: MarketplaceShopOption[] }>({
    queryKey: ["marketplace-shops", platform],
    queryFn: async () => {
      const response = await fetch(`/api/marketplace/shops?platform=${platform}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new MarketplaceApiError(body?.error?.code ?? String(response.status), body?.error?.message ?? `Request failed with status ${response.status}`);
      return body;
    },
  });
  const shops = shopsQuery.data?.shops ?? [];
  const draftFilters = withDefaultMarketplaceShop(draft, shops);
  const appliedFilters = withDefaultMarketplaceShop(applied, shops);
  const analyticsEnabled = !shopsQuery.isLoading && shops.length > 0 && Boolean(appliedFilters.shopId || appliedFilters.allShops);

  // Legacy analytics query for coverage/status
  const profitQuery = useQuery<MarketplaceMetricResponse>({
    queryKey: ["marketplace-profit", "2026-analytics-v1", platform, appliedFilters],
    queryFn: ({ signal }) => fetchMarketplaceMetric(platform, "profit", appliedFilters, undefined, signal),
    enabled: analyticsEnabled,
    retry: 1,
  });
  const coverage = profitQuery.data?.financialCoverage;

  // New profit detail query
  const profitDetailQuery = useQuery<ProfitDetailResponse>({
    queryKey: ["marketplace-profit-detail", platform, appliedFilters],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (appliedFilters.shopId) params.set("shopId", appliedFilters.shopId);
      if (appliedFilters.dateFrom) params.set("dateFrom", appliedFilters.dateFrom);
      if (appliedFilters.dateTo) params.set("dateTo", appliedFilters.dateTo);
      const response = await fetch(`/api/marketplace/profit-detail?platform=${platform}&${params}`, { signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new MarketplaceApiError(body?.error?.code ?? String(response.status), body?.error?.message ?? `Request failed with status ${response.status}`);
      return body;
    },
    enabled: analyticsEnabled,
    retry: 1,
  });

  const reconciliationStatusQuery = useQuery<MarketplaceReconciliationStatus>({
    queryKey: ["marketplace-reconciliation-status", platform, appliedFilters.shopId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/marketplace/reconciliation-status?platform=${platform}&shopId=${appliedFilters.shopId}`, { signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Unable to load reconciliation status.");
      return body;
    },
    enabled: Boolean(appliedFilters.shopId) && !appliedFilters.allShops,
    retry: 1,
  });

  const recordsQuery = useQuery<{ total: number; records: FinancialRecord[] }>({
    queryKey: ["marketplace-financial-records", platform, appliedFilters.shopId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/marketplace/financial-records?platform=${platform}&shopId=${appliedFilters.shopId}`, { signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Unable to load imported financial records.");
      return body;
    },
    enabled: Boolean(appliedFilters.shopId) && !appliedFilters.allShops,
    retry: 1,
  });

  const detail = profitDetailQuery.data;
  const provisional = detail?.coverage?.state === "provisional";
  const usable = detail && detail.coverage.state !== "unavailable";
  const currency = detail?.currency || financialReportingCurrency({ financialCoverage: coverage });
  const money = (value: number | null | undefined) => displayValue(value, currency ? (number) => formatMoney(number, currency) : undefined);

  const apply = (requestedFilters = draft) => {
    const next = withDefaultMarketplaceShop(requestedFilters, shops);
    const error = validateMarketplaceFilters(next);
    if (error) return setFilterError(error);
    setFilterError(null);
    setApplied(next);
    const query = marketplaceUrlQuery(next);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  const exportCsv = () => {
    if (!detail) return;
    const rows: Array<Array<string | number>> = [
      ["Metric", "Value"],
      ["Total revenue", detail.summary.totalRevenue],
      ["Total fees", detail.summary.totalFees],
      ["Total shipping", detail.summary.totalShipping],
      ["Seller income", detail.summary.sellerIncome],
      ["Overall margin", `${detail.summary.overallMargin}%`],
      ["Total orders", detail.summary.totalOrders],
      [],
      ["Product", "Revenue", "Qty Sold", "Orders", "Est. Fees", "Est. Profit", "Margin"],
      ...detail.byProduct.map((p) => [p.productName, p.revenue, p.quantitySold, p.orderCount, p.estimatedFees, p.estimatedProfit, `${p.margin}%`]),
    ];
    const csv = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${platform}-profit-detail.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const [financeSyncing, setFinanceSyncing] = useState(false);
  const [linkingRecords, setLinkingRecords] = useState(false);
  const syncFinance = async () => {
    if (!appliedFilters.shopId || appliedFilters.allShops) return setFilterError("Select one shop before syncing financial data.");
    setFinanceSyncing(true); setFilterError(null);
    try {
      const response = await fetch("/api/marketplace/finance-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, shopId: appliedFilters.shopId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Financial sync failed.");
      await profitQuery.refetch();
      await profitDetailQuery.refetch();
    } catch (error) { setFilterError(error instanceof Error ? error.message : "Financial sync failed."); }
    finally { setFinanceSyncing(false); }
  };
  const linkRecords = async () => {
    if (!appliedFilters.shopId || appliedFilters.allShops) return setFilterError("Select one shop before linking financial records.");
    setLinkingRecords(true); setFilterError(null);
    try {
      const response = await fetch("/api/marketplace/financial-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, shopId: appliedFilters.shopId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Financial linking failed.");
      await reconciliationStatusQuery.refetch();
    } catch (error) { setFilterError(error instanceof Error ? error.message : "Financial linking failed."); }
    finally { setLinkingRecords(false); }
  };

  const requestError = profitQuery.error as MarketplaceApiError | null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold">{title} Profit Tracking</h1>
          <p className="text-muted-foreground">Marketplace financial analytics are gated by existing readiness. COGS, advertising, payroll, overhead, and unverified fields are excluded.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={syncFinance} disabled={financeSyncing || !appliedFilters.shopId || appliedFilters.allShops}>
            {financeSyncing ? "Syncing financial data..." : "Sync financial data"}
          </Button>
          <Button type="button" variant="outline" onClick={linkRecords} disabled={linkingRecords || !appliedFilters.shopId || appliedFilters.allShops}>
            {linkingRecords ? "Linking records..." : "Link imported records"}
          </Button>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={!usable}>Export financial CSV</Button>
        </div>
      </div>

      <MarketplaceFilters filters={draftFilters} shops={shops} shopsLoading={shopsQuery.isLoading} noShops={!shopsQuery.isLoading && shops.length === 0} error={filterError ?? (shopsQuery.error instanceof MarketplaceApiError ? `${shopsQuery.error.code}: ${shopsQuery.error.message}` : null)} onChange={setDraft} onApply={apply} />

      {profitQuery.isLoading && <p className="text-muted-foreground">Loading applied profit filters...</p>}
      {requestError && <p role="alert" className="text-destructive">{requestError.code}: {requestError.message}</p>}

      {!profitQuery.isLoading && !requestError && shops.length > 0 && (
        <>
          <MarketplaceStatus financialCoverage={coverage} capabilities={profitQuery.data?.capabilities} />
          <ReconciliationStatus query={reconciliationStatusQuery} allShops={appliedFilters.allShops} />
          <ImportedFinancialRecords query={recordsQuery} />

          {usable || provisional ? (
            <>
              {provisional && (
                <Card className="border-yellow-200 bg-yellow-50">
                  <CardContent className="flex items-center gap-2 py-3 text-sm text-yellow-800">
                    <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Provisional data — 30-day maturity and a final provider statement are required before certification.
                  </CardContent>
                </Card>
              )}

              {/* Summary cards */}
              {detail && <SummaryCards summary={detail.summary} money={money} currency={currency} />}

              {/* Fee breakdown + Product table side by side */}
              {detail && detail.feeBreakdown.length > 0 && (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-1">
                    <FeeBreakdownChart feeBreakdown={detail.feeBreakdown} money={money} />
                  </div>
                  <div className="lg:col-span-2">
                    <ProfitByProductTable products={detail.byProduct} money={money} loading={profitDetailQuery.isLoading} />
                  </div>
                </div>
              )}

              {/* Product table full width when no fee breakdown (e.g. Shopify) */}
              {detail && detail.feeBreakdown.length === 0 && (
                <ProfitByProductTable products={detail.byProduct} money={money} loading={profitDetailQuery.isLoading} />
              )}

              {/* Shipping discrepancy */}
              {detail?.shippingDiscrepancy && <ShippingDiscrepancySection discrepancy={detail.shippingDiscrepancy} money={money} platform={platform} />}
            </>
          ) : (
            <Card>
              <CardHeader><CardTitle>Marketplace financial analytics unavailable</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Financial breakdown, product allocation, and CSV export remain disabled because this selection is {coverage?.state ?? "unavailable"}. Missing capability or category: {coverage?.missingCostCategories?.join(", ") || coverage?.unavailableReasons?.join(", ") || "financial readiness is unavailable"}. Operational product and order insights are available in Analytics.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Summary cards ───────────────────────────────────────────────────────────

function SummaryCards({ summary, money, currency }: { summary: ProfitDetailSummary; money: (v: number | null | undefined) => string; currency?: string }) {
  const cards = [
    { label: "Total Revenue", value: money(summary.totalRevenue), icon: DollarSign, color: "from-blue-500 to-blue-600" },
    { label: "Total Fees", value: money(summary.totalFees), icon: Receipt, color: "from-red-500 to-red-600" },
    { label: "Seller Income", value: money(summary.sellerIncome), icon: TrendingUp, color: "from-emerald-500 to-emerald-600" },
    { label: "Overall Margin", value: `${summary.overallMargin}%`, icon: Percent, color: "from-purple-500 to-purple-600" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="relative overflow-hidden">
          <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-5`} />
          <CardContent className="relative flex items-center gap-4 p-4">
            <div className={`rounded-lg bg-gradient-to-br ${color} p-2.5 text-white`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Fee breakdown donut chart ───────────────────────────────────────────────

function FeeBreakdownChart({ feeBreakdown, money }: { feeBreakdown: FeeBreakdownItem[]; money: (v: number | null | undefined) => string }) {
  const total = feeBreakdown.reduce((s, f) => s + f.amount, 0);
  const data = feeBreakdown.map((f) => ({ name: f.name, value: f.amount }));

  return (
    <Card className="h-full">
      <CardHeader><CardTitle>Fee Breakdown</CardTitle></CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" stroke="none">
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value) => money(typeof value === "number" ? value : undefined)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {feeBreakdown.map((f) => (
            <div key={f.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PIE_COLORS[feeBreakdown.indexOf(f) % PIE_COLORS.length] }} />
                <span>{f.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{f.percentage}%</span>
                <span className="font-medium">{money(f.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Profit by product table ─────────────────────────────────────────────────

const productColumns: ColumnDef<ProductProfitRow>[] = [
  { accessorKey: "productName", header: "Product", cell: ({ row }) => <span className="font-medium">{row.original.productName}</span> },
  { accessorKey: "revenue", header: "Revenue", cell: ({ row }) => row.original.revenue.toLocaleString() },
  { accessorKey: "quantitySold", header: "Qty Sold" },
  { accessorKey: "orderCount", header: "Orders" },
  { accessorKey: "estimatedFees", header: "Est. Fees", cell: ({ row }) => row.original.estimatedFees.toLocaleString() },
  { accessorKey: "estimatedProfit", header: "Est. Profit", cell: ({ row }) => {
    const v = row.original.estimatedProfit;
    return <span className={v >= 0 ? "text-emerald-600" : "text-red-600"}>{v.toLocaleString()}</span>;
  }},
  { accessorKey: "margin", header: "Margin", cell: ({ row }) => {
    const v = row.original.margin;
    return <span className={v >= 0 ? "text-emerald-600" : "text-red-600"}>{v}%</span>;
  }},
];

function ProfitByProductTable({ products, money, loading }: { products: ProductProfitRow[]; money: (v: number | null | undefined) => string; loading: boolean }) {
  const table = useReactTable({ data: products, columns: productColumns, getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 10 } } });

  return (
    <Card className="h-full">
      <CardHeader><CardTitle>Profit by Product</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading product breakdown...</p>
        ) : products.length === 0 ? (
          <p className="text-muted-foreground">No product data available for this selection.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} className="border-b py-2 pr-3 font-medium text-muted-foreground">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="py-2 pr-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Shipping discrepancy section ────────────────────────────────────────────

function ShippingDiscrepancySection({ discrepancy, money, platform }: { discrepancy: { summary: { totalOrders: number; ordersWithDiscrepancy: number; totalEstimated: number; totalActual: number; totalDiscrepancy: number }; products: ShippingDiscrepancyProduct[] }; money: (v: number | null | undefined) => string; platform: MarketplacePlatform }) {
  const [csvUrl, setCsvUrl] = useState<string | null>(null);

  const exportCsv = () => {
    const rows: Array<Array<string | number>> = [
      ["Product", "Orders", "Total Estimated", "Total Actual", "Avg Discrepancy", "Discrepancy %"],
      ...discrepancy.products.map((p) => [p.productName, p.orderCount, p.totalEstimated, p.totalActual, p.avgDiscrepancy, `${p.discrepancyPct}%`]),
    ];
    const csv = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    if (csvUrl) URL.revokeObjectURL(csvUrl);
    setCsvUrl(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${platform}-shipping-discrepancy.csv`;
    link.click();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Shipping Fee Discrepancy</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </CardHeader>
      <CardContent>
        {/* Summary grid */}
        <div className="mb-4 grid gap-4 sm:grid-cols-5">
          {[
            { label: "Total Orders", value: String(discrepancy.summary.totalOrders) },
            { label: "With Discrepancy", value: String(discrepancy.summary.ordersWithDiscrepancy) },
            { label: "Total Estimated", value: money(discrepancy.summary.totalEstimated) },
            { label: "Total Actual", value: money(discrepancy.summary.totalActual) },
            { label: "Total Difference", value: money(discrepancy.summary.totalDiscrepancy) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>

        {/* Product table */}
        {discrepancy.products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Product</th>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Orders</th>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Total Estimated</th>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Total Actual</th>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Avg Discrepancy</th>
                  <th className="border-b py-2 pr-3 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {discrepancy.products.map((p) => (
                  <tr key={p.productName} className="border-t">
                    <td className="py-2 pr-3 font-medium">{p.productName}</td>
                    <td className="py-2 pr-3">{p.orderCount}</td>
                    <td className="py-2 pr-3">{money(p.totalEstimated)}</td>
                    <td className="py-2 pr-3">{money(p.totalActual)}</td>
                    <td className="py-2 pr-3">{money(p.avgDiscrepancy)}</td>
                    <td className="py-2">
                      {Math.abs(p.discrepancyPct) <= 10 ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Normal</span>
                      ) : Math.abs(p.discrepancyPct) <= 30 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">Moderate</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">High</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No shipping discrepancy data available.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Reconciliation status (existing) ────────────────────────────────────────

type MarketplaceReconciliationStatus = {
  importedLedgerCount: number;
  linkedOrderCount: number;
  unmatchedOrderCount: number;
  certifiedReconciliationCount: number;
  latestAutomaticReconciliation: { decision: string; periodEnd: string; updatedAt: string } | null;
  recordsProvisional: boolean;
};

function ReconciliationStatus({ query, allShops }: { query: ReturnType<typeof useQuery<MarketplaceReconciliationStatus>>; allShops: boolean }) {
  const status = query.data;
  return (
    <Card>
      <CardHeader><CardTitle>Reconciliation status</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {allShops ? <p>Select one shop to view reconciliation status.</p>
          : query.isLoading ? <p>Loading reconciliation status...</p>
          : query.error ? <p className="text-destructive">{query.error.message}</p>
          : status ? (
            <>
              <p>Imported ledger records: {status.importedLedgerCount}; linked to orders: {status.linkedOrderCount}; unmatched: {status.unmatchedOrderCount}.</p>
              <p>Certified reconciliations: {status.certifiedReconciliationCount}.</p>
              <p>Latest automatic reconciliation: {status.latestAutomaticReconciliation ? `${status.latestAutomaticReconciliation.decision} on ${new Date(status.latestAutomaticReconciliation.updatedAt).toLocaleDateString()} (period ended ${new Date(status.latestAutomaticReconciliation.periodEnd).toLocaleDateString()})` : "None"}.</p>
              <p>Ledger status: {status.recordsProvisional ? "Provisional. 30-day maturity and a final provider statement are required before certification." : status.importedLedgerCount ? "A current certified reconciliation is present." : "No imported ledger records."}</p>
            </>
          ) : <p>Reconciliation status is unavailable.</p>}
      </CardContent>
    </Card>
  );
}

// ── Imported financial records (existing) ────────────────────────────────────

type FinancialRecord = { id: string; externalId: string; orderExternalId: string | null; transactionType: string | null; feeType: string | null; feeName: string | null; amountMinor: string | null; amountScale: number; currency: string | null; occurredAt: string | null; sourceObservedAt: string | null; financialQuality: string; unknownReason: string | null };

function ImportedFinancialRecords({ query }: { query: ReturnType<typeof useQuery<{ total: number; records: FinancialRecord[] }>> }) {
  const records = query.data?.records ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Imported financial records{query.data ? ` (${query.data.total})` : ""}</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {query.isLoading ? <p className="text-muted-foreground">Loading imported financial records...</p>
          : query.error ? <p className="text-destructive">{query.error.message}</p>
          : records.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr><th>Transaction</th><th>Type</th><th>Order</th><th>Amount</th><th>Observed</th></tr></thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-t">
                      <td className="py-2 pr-3">{record.feeName ?? record.feeType ?? record.externalId}</td>
                      <td className="py-2 pr-3">{record.transactionType ?? "Unknown"}</td>
                      <td className="py-2 pr-3">{record.orderExternalId ?? "-"}</td>
                      <td className="py-2 pr-3">{displayImportedAmount(record)}</td>
                      <td className="py-2">{record.occurredAt ? new Date(record.occurredAt).toLocaleDateString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted-foreground">No financial records have been imported for this shop.</p>}
        <p className="mt-3 text-xs text-muted-foreground">These are raw marketplace records for review. They are not reconciled profit calculations.</p>
      </CardContent>
    </Card>
  );
}

function displayImportedAmount(record: FinancialRecord) {
  if (!record.amountMinor) return "Unavailable";
  const amount = Number(record.amountMinor) / 10 ** record.amountScale;
  if (!Number.isFinite(amount)) return "Unavailable";
  return record.currency ? formatMoney(amount, record.currency) : amount.toLocaleString(undefined, { maximumFractionDigits: record.amountScale });
}
