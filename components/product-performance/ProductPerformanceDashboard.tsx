"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useDeferredValue, useState, useSyncExternalStore } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, type ColumnDef, type SortingState, useReactTable } from "@tanstack/react-table";
import { AlertTriangle, Box, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, PackageSearch, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useProductPerformance } from "@/hooks/queries/use-product-performance";
import type { ProductPerformanceRow, ProductRecommendation } from "@/types/product-performance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ProductView = ProductRecommendation | "action" | "overstock" | "all";

const views: { value: ProductView; label: string }[] = [
  { value: "action", label: "Action queue" },
  { value: "critical", label: "Critical" },
  { value: "reorder", label: "Reorder" },
  { value: "watch", label: "Watch" },
  { value: "overstock", label: "Excess & dormant" },
  { value: "healthy", label: "Healthy" },
  { value: "not-stocked", label: "Not stocked" },
  { value: "inactive", label: "Inactive" },
  { value: "data-issue", label: "Data issues" },
  { value: "all", label: "All products" },
];
const presets = [{ label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "90D", days: 90 }];
const PAGE_SIZE = 50;
const MAX_EXPANDED_SALES_SKUS = 50;
const subscribeToHydration = () => () => {};
const severity: Record<ProductRecommendation, number> = { critical: 0, reorder: 1, watch: 2, "data-issue": 3, excess: 4, dormant: 5, "not-stocked": 6, healthy: 7, inactive: 8 };
const reasonLabels: Record<string, string> = {
  "out-of-stock-with-demand": "Demand exists but no component stock is available",
  "stockout-before-replenishment": "Stock is projected to run out inside supplier lead time",
  "inbound-arrives-after-stockout": "Inbound stock is due after the projected stockout",
  "inventory-position-below-reorder-point": "Available plus inbound stock is below the reorder point",
  "inbound-covers-current-shortfall": "Confirmed inbound stock covers the current shortfall",
  "zero-sales-with-stock": "Stock is held without qualified demand in this period",
  "no-demand-and-no-stock": "No reliable demand or stock was observed",
  "stock-above-maximum-cover": "Stock exceeds the maximum cover policy",
  "demand-growing-near-reorder-window": "Demand is growing near the reorder window",
  "inventory-within-policy": "Inventory is within the current policy band",
  "supplier-lead-time-unavailable": "Supplier lead time is missing",
  "incomplete-observation-coverage": "There is not enough sales history",
  "inactive-product": "The product is inactive",
};

const label = (value: string) => value.replaceAll("-", " ");
const reasonLabel = (value: string) => reasonLabels[value] ?? label(value);
const formatNumber = (value: number, maximumFractionDigits = 1) => new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not available";
const recommendationVariant = (value: ProductRecommendation) => {
  if (value === "critical") return "destructive" as const;
  if (value === "healthy") return "success" as const;
  if (value === "watch" || value === "data-issue") return "info" as const;
  if (value === "dormant" || value === "not-stocked" || value === "inactive") return "secondary" as const;
  return "warning" as const;
};
const productViewFrom = (value: string | null): ProductView => views.some((item) => item.value === value) ? value as ProductView : "action";

export function dateFor(days: number, now = new Date()) {
  const to = new Date(now);
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
}

export function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export default function ProductPerformanceDashboard() {
  // React Query can restore persisted browser data before this client component
  // hydrates. Render the same loading shell as SSR until hydration is complete.
  const hasHydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const params = useSearchParams();
  const initialPeriod = Number(params.get("period"));
  const period = [7, 30, 90].includes(initialPeriod) ? initialPeriod : 30;
  const fallbackRange = dateFor(period);
  const requestedDateFrom = params.get("dateFrom");
  const requestedDateTo = params.get("dateTo");
  const [dateFrom, setDateFrom] = useState(() => isValidDate(requestedDateFrom) ? requestedDateFrom : fallbackRange.dateFrom);
  const [dateTo, setDateTo] = useState(() => isValidDate(requestedDateTo) ? requestedDateTo : fallbackRange.dateTo);
  const [activePeriod, setActivePeriod] = useState<number | null>(() => requestedDateFrom || requestedDateTo ? null : period);
  const [view, setView] = useState<ProductView>(() => productViewFrom(params.get("view")));
  const [tier, setTier] = useState(() => {
    const value = params.get("tier") ?? "";
    return ["A", "B", "C"].includes(value) ? value : "";
  });
  const [performance, setPerformance] = useState(() => {
    const value = params.get("performance") ?? "";
    return ["growing", "stable", "declining", "no-demand", "insufficient-data"].includes(value) ? value : "";
  });
  const [requestedChannel, setRequestedChannel] = useState(() => params.get("channel") ?? "");
  const [category, setCategory] = useState(() => params.get("category") ?? "");
  const [search, setSearch] = useState(() => params.get("search") ?? "");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const { data, isLoading, error } = useProductPerformance({ dateFrom, dateTo, view, page, pageSize: PAGE_SIZE, tier, performance, channel: requestedChannel, category, search: deferredSearch });

  const setParam = (key: string, value: string) => {
    if (key === "view") setView(productViewFrom(value));
    if (key === "tier") setTier(value);
    if (key === "performance") setPerformance(value);
    if (key === "channel") setRequestedChannel(value);
    if (key === "category") setCategory(value);
    if (key === "search") setSearch(value);
    if (key === "dateFrom") { setDateFrom(value || fallbackRange.dateFrom); setActivePeriod(null); }
    if (key === "dateTo") { setDateTo(value || fallbackRange.dateTo); setActivePeriod(null); }
    setExpanded(null);
    setPage(0);
  };
  const setPreset = (value: number) => {
    const range = dateFor(value);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setActivePeriod(value);
    setExpanded(null);
    setPage(0);
  };

  const products = data?.products ?? [];
  const channels = [...new Set(products.flatMap((row) => Object.keys(row.channelDemand ?? {})))].sort();
  const channel = channels.includes(requestedChannel) ? requestedChannel : "";
  const categories = [...new Set(products.map((row) => row.category).filter((value): value is string => Boolean(value)))].sort();
  const rows = products
    .sort((a, b) => {
      const actionDateA = new Date(a.reorderByDate ?? a.projectedStockoutDate ?? "9999-12-31").getTime();
      const actionDateB = new Date(b.reorderByDate ?? b.projectedStockoutDate ?? "9999-12-31").getTime();
      const tierPriority = { A: 0, B: 1, C: 2 } as const;
      const confidencePriority = { high: 0, medium: 1, "needs-data": 2 } as const;
      return severity[a.recommendation] - severity[b.recommendation]
        || actionDateA - actionDateB
        || (a.tier ? tierPriority[a.tier] : 3) - (b.tier ? tierPriority[b.tier] : 3)
        || confidencePriority[a.confidence] - confidencePriority[b.confidence];
    });
  const pageCount = data?.pagination.totalPages ?? 1;
  const currentPage = data?.pagination.page ?? 0;
  const tableRows = rows;

  const countForView = (value: ProductView) => {
    if (!data) return 0;
    if (value === "all") return data.summary.inactive + data.summary.critical + data.summary.reorder + data.summary.watch + data.summary.healthy + data.summary.excess + data.summary.dormant + data.summary["not-stocked"] + data.summary["data-issue"];
    if (value === "action") return data.summary.action;
    if (value === "overstock") return data.summary.excess + data.summary.dormant;
    return data.summary[value];
  };

  const columns: ColumnDef<ProductPerformanceRow>[] = [
    {
      accessorKey: "name",
      header: "Product",
      cell: ({ row }) => <div className="min-w-44"><Link className="font-semibold hover:underline" href={`/admin/products/${row.original.id}`}>{row.original.name}</Link><span className="block font-mono text-xs text-muted-foreground">{row.original.sku}</span>{row.original.category && <span className="mt-1 block text-xs text-muted-foreground">{row.original.category}</span>}</div>,
    },
    {
      accessorKey: "recommendation",
      header: "Action",
      cell: ({ row }) => <div className="min-w-48"><Badge variant={recommendationVariant(row.original.recommendation)}>{label(row.original.recommendation)}</Badge><span className="mt-1.5 block text-xs leading-4 text-muted-foreground">{reasonLabel(row.original.reasons[0] ?? "")}</span></div>,
    },
    {
      accessorKey: "totalNormalizedUnits",
      header: "Physical demand",
      cell: ({ row }) => <div className="min-w-36"><span className="font-medium">{formatNumber(row.original.totalNormalizedUnits, 0)} units</span><span className="block text-xs text-muted-foreground">{formatNumber(row.original.dailyVelocity ?? 0)} / day</span><span className="block text-xs text-muted-foreground">{row.original.unitsSold} WMS + {row.original.marketplaceNormalizedUnits ?? 0} marketplace</span></div>,
    },
    {
      accessorKey: "inventoryPosition",
      header: "Stock position",
      cell: ({ row }) => <div className="min-w-36"><span className="font-medium">{formatNumber(row.original.inventoryPosition, 0)} positioned</span><span className="block text-xs text-muted-foreground">{row.original.available} available + {row.original.inboundQuantity} inbound</span>{row.original.reserved > 0 && <span className="block text-xs text-muted-foreground">{row.original.reserved} reserved</span>}</div>,
    },
    {
      accessorKey: "daysOfCover",
      header: "Cover / target",
      cell: ({ row }) => {
        const cover = row.original.daysOfCover;
        const target = row.original.targetCoverDays;
        const ratio = cover !== null && target ? Math.min(100, Math.max(0, (cover / target) * 100)) : 0;
        return <div className="min-w-32"><span className="font-medium">{cover === null ? "No demand" : `${cover} days`}</span><span className="block text-xs text-muted-foreground">Target {target === null ? "needs lead time" : `${target} days`}</span>{cover !== null && target !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", cover < target ? "bg-orange-500" : cover > (data?.defaults.maxCoverDays ?? 90) ? "bg-violet-500" : "bg-emerald-500")} style={{ width: `${ratio}%` }} /></div>}</div>;
      },
    },
    {
      accessorKey: "projectedStockoutDate",
      header: "Timing",
      cell: ({ row }) => <div className="min-w-36"><span className="text-xs text-muted-foreground">Stockout</span><span className="block font-medium">{formatDate(row.original.projectedStockoutDate)}</span><span className="mt-1 block text-xs text-muted-foreground">Reorder by {formatDate(row.original.reorderByDate)}</span></div>,
    },
    {
      accessorKey: "demandPerformance",
      header: "Demand",
      cell: ({ row }) => <div className="min-w-28"><Badge variant={row.original.demandPerformance === "growing" ? "success" : row.original.demandPerformance === "declining" ? "warning" : "outline"}>{row.original.demandPerformance}</Badge><span className="mt-1 block text-xs text-muted-foreground">{row.original.tier ? `ABC ${row.original.tier}` : "Unranked"}</span></div>,
    },
    {
      accessorKey: "confidence",
      header: "Confidence",
      cell: ({ row }) => <div className="min-w-32"><Badge variant={row.original.confidence === "high" ? "success" : row.original.confidence === "medium" ? "warning" : "info"}>{row.original.confidence}</Badge><span className="mt-1 block text-xs leading-4 text-muted-foreground">{row.original.confidenceReasons.length ? row.original.confidenceReasons.map(label).join(", ") : row.original.coverage}</span></div>,
    },
  ];
  const table = useReactTable({ data: tableRows, columns, getRowId: (row) => row.id, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  if (!hasHydrated || isLoading) return <div className="space-y-4"><h1 className="text-2xl font-bold">Product Attention</h1><div className="h-72 animate-pulse rounded-xl bg-muted" /></div>;
  if (error) return <div><h1 className="text-2xl font-bold">Product Attention</h1><p className="mt-4 text-destructive">Could not load inventory decisions. Try again.</p></div>;

  const summaryCards = [
    { view: "critical" as const, title: "Critical", count: data?.summary.critical ?? 0, detail: "Stockout risk", icon: AlertTriangle, className: "text-red-700 dark:text-red-400" },
    { view: "reorder" as const, title: "Reorder now", count: data?.summary.reorder ?? 0, detail: "Below reorder point", icon: RefreshCw, className: "text-orange-700 dark:text-orange-400" },
    { view: "watch" as const, title: "Watch", count: data?.summary.watch ?? 0, detail: "Inbound or rising demand", icon: CircleHelp, className: "text-blue-700 dark:text-blue-400" },
    { view: "overstock" as const, title: "Overstock", count: (data?.summary.excess ?? 0) + (data?.summary.dormant ?? 0), detail: "Excess or no demand", icon: PackageSearch, className: "text-violet-700 dark:text-violet-400" },
    { view: "healthy" as const, title: "Healthy", count: data?.summary.healthy ?? 0, detail: "Within policy", icon: CheckCircle2, className: "text-emerald-700 dark:text-emerald-400" },
    { view: "not-stocked" as const, title: "Not stocked", count: data?.summary["not-stocked"] ?? 0, detail: "No stock or demand", icon: Box, className: "text-slate-700 dark:text-slate-300" },
  ];

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Inventory control</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Product Attention</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">A component-level action queue using combined WMS and normalized marketplace demand. Commercial demand and inventory health remain separate so a strong seller can still be flagged as an urgent stock risk.</p></div>
      <Link className="text-sm font-medium underline underline-offset-4" href="/admin/inventory/sku-mapping">Manage SKU linking</Link>
    </div>

    {data?.attribution.state === "unprojected" && <div className="rounded-xl border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><strong>Marketplace demand is not yet attributed.</strong> {data.attribution.rawShopeeOrderItems} Shopee order items exist in this period, but none have been projected to physical component SKUs. Stock decisions currently exclude those sales. Complete mapping review, then run the Shopee attribution backfill.</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{summaryCards.map((item) => {
      const Icon = item.icon;
      const selected = view === item.view || (view === "action" && ["critical", "reorder", "watch", "overstock"].includes(item.view));
      return <button key={item.view} className="text-left" onClick={() => setParam("view", item.view)}><Card className={cn("h-full transition-colors hover:border-foreground/30", selected && "border-foreground/40 bg-muted/35")}><CardContent className="flex items-start justify-between p-4"><div><span className="text-2xl font-bold tabular-nums">{item.count}</span><p className="mt-1 text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div><Icon className={cn("h-5 w-5", item.className)} /></CardContent></Card></button>;
    })}</div>

    <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap gap-2">{views.map((item) => <Button key={item.value} size="sm" variant={view === item.value ? "default" : "ghost"} onClick={() => setParam("view", item.value)}>{item.label} <span className="ml-1 text-xs opacity-70">{countForView(item.value)}</span></Button>)}</div>
      <div className="flex flex-wrap gap-2 border-t pt-3">{presets.map((item) => <Button key={item.days} size="sm" variant={activePeriod === item.days ? "default" : "outline"} onClick={() => setPreset(item.days)}>{item.label}</Button>)}<label className="sr-only" htmlFor="product-performance-date-from">From date</label><Input id="product-performance-date-from" className="w-36" type="date" max={fallbackRange.dateTo} value={dateFrom} onChange={(event) => setParam("dateFrom", event.target.value)} /><label className="sr-only" htmlFor="product-performance-date-to">To date</label><Input id="product-performance-date-to" className="w-36" type="date" max={fallbackRange.dateTo} value={dateTo} onChange={(event) => setParam("dateTo", event.target.value)} /><select className="rounded-md border bg-background px-3 text-sm" value={tier} onChange={(event) => setParam("tier", event.target.value)} title="ABC is descriptive and does not determine health."><option value="">All ABC tiers</option><option>A</option><option>B</option><option>C</option></select><select className="rounded-md border bg-background px-3 text-sm" value={performance} onChange={(event) => setParam("performance", event.target.value)}><option value="">All demand</option><option value="growing">Growing</option><option value="stable">Stable</option><option value="declining">Declining</option><option value="no-demand">No demand</option><option value="insufficient-data">Insufficient data</option></select>{channels.length > 0 && <select className="rounded-md border bg-background px-3 text-sm" value={channel} onChange={(event) => setParam("channel", event.target.value)}><option value="">All channels</option>{channels.map((item) => <option key={item} value={item}>{item}</option>)}</select>}{categories.length > 0 && <select className="rounded-md border bg-background px-3 text-sm" value={category} onChange={(event) => setParam("category", event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>}<label className="sr-only" htmlFor="product-performance-search">Search products</label><Input id="product-performance-search" className="min-w-52 flex-1" placeholder="Search product or component SKU" value={search} onChange={(event) => setParam("search", event.target.value)} /></div>
    </div>

    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}><button className="flex items-center gap-1 whitespace-nowrap" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === "asc" ? <ChevronUp size={14} /> : header.column.getIsSorted() === "desc" ? <ChevronDown size={14} /> : null}</button></TableHead>)}<TableHead>Details</TableHead></TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map((row) => <Fragment key={row.id}><TableRow className={row.original.recommendation === "critical" ? "bg-red-500/[0.03]" : undefined}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} className="align-top">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}<TableCell className="align-top"><Button variant="ghost" size="sm" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Hide" : "Inspect"}</Button></TableCell></TableRow>{expanded === row.id && <TableRow><TableCell colSpan={columns.length + 1} className="bg-muted/25 p-0"><ProductDetails row={row.original} safetyDays={data?.defaults.safetyDays ?? 7} maxCoverDays={data?.defaults.maxCoverDays ?? 90} /></TableCell></TableRow>}</Fragment>)}{!rows.length && <TableRow><TableCell colSpan={columns.length + 1} className="h-32 text-center text-muted-foreground">No products match these filters.</TableCell></TableRow>}</TableBody></Table></div>
    {(data?.pagination.total ?? 0) > PAGE_SIZE && <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Showing {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, data?.pagination.total ?? 0)} of {data?.pagination.total} products</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => { setExpanded(null); setPage(currentPage - 1); }}>Previous</Button><span className="flex items-center px-2">Page {currentPage + 1} of {pageCount}</span><Button size="sm" variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => { setExpanded(null); setPage(currentPage + 1); }}>Next</Button></div></div>}
  </div>;
}

function ProductDetails({ row, safetyDays, maxCoverDays }: { row: ProductPerformanceRow; safetyDays: number; maxCoverDays: number }) {
  const visibleSalesSkus = row.contributingSalesSkus?.slice(0, MAX_EXPANDED_SALES_SKUS) ?? [];
  const hiddenSalesSkuCount = Math.max(0, (row.contributingSalesSkus?.length ?? 0) - visibleSalesSkus.length);
  return <div className="grid gap-6 p-5 lg:grid-cols-4">
    <section><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why this action</p><p className="mt-2 font-medium">{reasonLabel(row.reasons[0] ?? "")}</p><p className="mt-2 text-sm text-muted-foreground">Confidence: {row.confidence}. {row.coverage}.</p>{row.suggestedQuantity !== null && <p className="mt-3 rounded-lg bg-background p-3 text-sm"><span className="block text-xs text-muted-foreground">Suggested quantity</span><strong className="text-lg">{row.suggestedQuantity}</strong> component units</p>}</section>
    <section><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inventory position</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">On hand</dt><dd className="text-right font-medium">{row.onHand}</dd><dt className="text-muted-foreground">Reserved</dt><dd className="text-right font-medium">{row.reserved}</dd><dt className="text-muted-foreground">Available</dt><dd className="text-right font-medium">{row.available}</dd><dt className="text-muted-foreground">Inbound</dt><dd className="text-right font-medium">{row.inboundQuantity}</dd><dt className="text-muted-foreground">Position</dt><dd className="text-right font-semibold">{row.inventoryPosition}</dd><dt className="text-muted-foreground">Next receipt</dt><dd className="text-right font-medium">{formatDate(row.nextInboundDate)}</dd></dl></section>
    <section><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planning policy</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">Velocity</dt><dd className="text-right font-medium">{formatNumber(row.dailyVelocity ?? 0)} / day</dd><dt className="text-muted-foreground">Lead time</dt><dd className="text-right font-medium">{row.supplierLeadTimeDays ?? "Missing"}</dd><dt className="text-muted-foreground">Safety</dt><dd className="text-right font-medium">{safetyDays} days</dd><dt className="text-muted-foreground">Max cover</dt><dd className="text-right font-medium">{maxCoverDays} days</dd><dt className="text-muted-foreground">Position cover</dt><dd className="text-right font-medium">{row.inventoryPositionDaysOfCover === null ? "N/A" : `${row.inventoryPositionDaysOfCover} days`}</dd></dl></section>
    <section><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commercial signal</p><div className="mt-2 flex items-center gap-2">{row.demandPerformance === "growing" ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : row.demandPerformance === "declining" ? <TrendingDown className="h-4 w-4 text-orange-600" /> : null}<span className="font-medium capitalize">{label(row.demandPerformance)}</span></div><p className="mt-2 text-sm text-muted-foreground">{row.unitsSold} WMS units and {row.marketplaceNormalizedUnits ?? 0} normalized marketplace units.</p>{row.reviewQuality && <p className="mt-2 text-sm text-muted-foreground">Reviews: {row.reviewQuality.averageRating.toFixed(1)}/5 from {row.reviewQuality.count} approved reviews.</p>}{row.commercialSignals.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{row.commercialSignals.map((signal) => <Badge key={signal} variant="warning">{label(signal)}</Badge>)}</div>}</section>
    {(row.channelDemand || row.contributingSalesSkus) && <section className="border-t pt-5 lg:col-span-4"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channel and kit demand</p><p className="mt-1 text-sm text-muted-foreground">Listing sales are normalized into this component&apos;s physical unit before stock decisions are made.</p></div>{row.marketplaceCoverage && <p className="text-xs text-muted-foreground">{row.marketplaceCoverage.observedOffers} of {row.marketplaceCoverage.linkedOffers} linked offers had activity in this period. This is not mapping completeness.</p>}</div>{row.channelDemand && <div className="mt-4 flex flex-wrap gap-2">{Object.entries(row.channelDemand).map(([channel, demand]) => <div key={channel} className="rounded-lg border bg-background px-3 py-2 text-sm"><span className="font-semibold capitalize">{channel}</span><span className="ml-2 text-muted-foreground">{demand.marketplaceUnits} listing units to {demand.normalizedUnits} component units</span></div>)}</div>}{visibleSalesSkus.length > 0 && <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleSalesSkus.map((sku) => <div key={sku.id} className="rounded-lg border bg-background p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{sku.name}</p><p className="font-mono text-xs text-muted-foreground">{sku.code}</p></div>{sku.isKit && <Badge variant="info">kit</Badge>}</div><p className="mt-3 text-sm">{sku.marketplaceUnits ?? "Unknown"} listing units consumed <strong>{sku.normalizedUnits}</strong> component units.</p><p className="mt-1 text-xs text-muted-foreground">{sku.unitsPerSale === null ? "Pack size unavailable" : `${formatNumber(sku.unitsPerSale)} component units per listing sale`} | {sku.channels.join(", ")}</p>{sku.componentSupportedQuantity !== null && <p className="mt-2 text-xs font-medium">Current component stock supports {sku.componentSupportedQuantity} listing units. Multi-component kits may be constrained by another component.</p>}</div>)}</div>}{hiddenSalesSkuCount > 0 && <p className="mt-3 text-sm text-muted-foreground">Showing the first {MAX_EXPANDED_SALES_SKUS} of {row.contributingSalesSkus?.length} linked Sales SKUs.</p>}</section>}
  </div>;
}
