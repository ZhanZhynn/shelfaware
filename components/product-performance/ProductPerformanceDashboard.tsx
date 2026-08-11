"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, type ColumnDef, type SortingState, useReactTable } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useProductPerformance } from "@/hooks/queries/use-product-performance";
import type { ProductPerformanceRow, ProductRecommendation } from "@/types/product-performance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const views: { value: ProductRecommendation | "all"; label: string }[] = [{ value: "restock", label: "Restock" }, { value: "review-excess", label: "Review excess" }, { value: "review-listing", label: "Review listing" }, { value: "all", label: "All products" }, { value: "needs-data", label: "Needs data" }];
const presets = [{ label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "90D", days: 90 }];
const label = (value: string) => value.replaceAll("-", " ");
function dateFor(days: number) { const to = new Date(); const from = new Date(to); from.setDate(to.getDate() - days); return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }; }
function safeDate(value: string | null, fallback: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) ? value : fallback; }

export default function ProductPerformanceDashboard() {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const initial = Number(params.get("period")); const period = [7, 30, 90].includes(initial) ? initial : 30;
  const fallbackRange = dateFor(period); const dateFrom = safeDate(params.get("dateFrom"), fallbackRange.dateFrom); const dateTo = safeDate(params.get("dateTo"), fallbackRange.dateTo); const { data, isLoading, error } = useProductPerformance({ dateFrom, dateTo });
  const view = views.some(({ value }) => value === params.get("view")) ? (params.get("view") ?? "all") as ProductRecommendation | "all" : "all";
  const tierValue = params.get("tier") ?? ""; const tier = ["A", "B", "C"].includes(tierValue) ? tierValue : "";
  const channel = ["all", "mapped", "needs-mapping"].includes(params.get("channel") ?? "") ? params.get("channel") ?? "all" : "all";
  const search = params.get("search") ?? ""; const [sorting, setSorting] = useState<SortingState>([]); const [expanded, setExpanded] = useState<string | null>(null);
  const setParam = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); if (key === "dateFrom" || key === "dateTo") next.delete("period"); if (!value || value === "all") next.delete(key); else next.set(key, value); router.replace(`${pathname}?${next}`); };
  const setPreset = (value: number) => { const next = new URLSearchParams(params.toString()); next.delete("dateFrom"); next.delete("dateTo"); next.set("period", String(value)); router.replace(`${pathname}?${next}`); };
  const rows = (data?.products ?? []).filter((row) => (view === "all" || row.recommendation === view) && (!tier || row.tier === tier) && (channel === "all" || row.shopeeCoverage === channel) && `${row.name} ${row.sku}`.toLowerCase().includes(search.toLowerCase()));
  const columns: ColumnDef<ProductPerformanceRow>[] = [
    { accessorKey: "name", header: "Product", cell: ({ row }) => <Link className="font-medium hover:underline" href={`/admin/products/${row.original.id}`}>{row.original.name}<span className="block text-xs text-muted-foreground">{row.original.sku}</span></Link> },
    { accessorKey: "recommendation", header: "Decision", cell: ({ row }) => <><Badge variant={row.original.recommendation === "restock" ? "destructive" : row.original.recommendation === "healthy" ? "success" : "warning"}>{label(row.original.recommendation)}</Badge><span className="mt-1 block text-xs text-muted-foreground">{label(row.original.reasons[0] ?? "")}</span></> },
    { accessorKey: "available", header: "Stock", cell: ({ row }) => <>{row.original.available} available<span className="block text-xs text-muted-foreground">{row.original.onHand} on hand, {row.original.reserved} reserved</span></> },
    { accessorKey: "unitsSold", header: "Observed", cell: ({ row }) => `${row.original.unitsSold} units` },
    { accessorKey: "daysOfCover", header: "Cover", cell: ({ row }) => row.original.daysOfCover == null ? "-" : `${row.original.daysOfCover} days` },
    { accessorKey: "tier", header: "Tier", cell: ({ row }) => row.original.tier ?? "-" },
    { accessorKey: "confidence", header: "Coverage", cell: ({ row }) => <>{row.original.confidence}<span className="block text-xs text-muted-foreground">{row.original.coverage}</span></> },
  ];
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  if (isLoading) return <div className="space-y-4"><h1 className="text-2xl font-bold">Product Performance</h1><div className="h-72 animate-pulse rounded-lg bg-muted" /></div>;
  if (error) return <div><h1 className="text-2xl font-bold">Product Performance</h1><p className="mt-4 text-destructive">Could not load product decisions. Try again.</p></div>;
  return <div className="space-y-5"><div><h1 className="text-2xl font-bold">Product Performance</h1><p className="text-muted-foreground">Recommendations use WMS inventory, sales, supplier lead time, and review-quality signals. ABC tier and mapped Shopee visibility are informational filters only.</p></div>
    <div className="flex flex-wrap gap-2">{views.map((item) => <Button key={item.value} size="sm" variant={view === item.value ? "default" : "outline"} onClick={() => setParam("view", item.value)}>{item.label} ({item.value === "all" ? data?.products.length ?? 0 : data?.summary[item.value] ?? 0})</Button>)}</div>
    <div className="flex flex-wrap gap-2">{presets.map((item) => <Button key={item.days} size="sm" variant={period === item.days ? "default" : "outline"} onClick={() => setPreset(item.days)}>{item.label}</Button>)}<Input className="w-40" type="date" value={dateFrom} onChange={(event) => setParam("dateFrom", event.target.value)} /><Input className="w-40" type="date" value={dateTo} onChange={(event) => setParam("dateTo", event.target.value)} /><select className="rounded border bg-background px-2 text-sm" value={tier} onChange={(event) => setParam("tier", event.target.value)} title="ABC tier is descriptive and does not affect recommendations."><option value="">All tiers</option><option>A</option><option>B</option><option>C</option></select><select className="rounded border bg-background px-2 text-sm" value={channel} onChange={(event) => setParam("channel", event.target.value)}><option value="all">All visibility</option><option value="mapped">Mapped Shopee</option><option value="needs-mapping">Needs mapping</option></select><Input className="w-56" placeholder="Search name or SKU" value={search} onChange={(event) => setParam("search", event.target.value)} /></div>
    <div className="overflow-x-auto rounded-lg border"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}><button className="flex items-center gap-1" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === "asc" ? <ChevronUp size={14} /> : header.column.getIsSorted() === "desc" ? <ChevronDown size={14} /> : null}</button></TableHead>)}<TableHead>Details</TableHead></TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map((row) => <><TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}<TableCell><Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Hide" : "Show"}</Button></TableCell></TableRow>{expanded === row.id && <TableRow key={`${row.id}-details`}><TableCell colSpan={columns.length + 1} className="bg-muted/40 text-sm">Velocity: {row.original.dailyVelocity ?? "-"} units/day. Lead time: {row.original.supplierLeadTimeDays ?? "not recorded"}. Safety stock: {data?.defaults.safetyDays} days. Inbound PO quantity: not included until partially received PO quantities can be safely reconciled. Suggested quantity: {row.original.suggestedQuantity ?? "-"}. Tier: {row.original.tier ?? "unranked"} (informational). Shopee: {row.original.shopeeCoverage} (informational). {row.original.reviewQuality ? ` Approved review quality: ${row.original.reviewQuality.averageRating.toFixed(1)}/5 from ${row.original.reviewQuality.count}.` : " No approved review-quality signal."}</TableCell></TableRow>}</>)}{!rows.length && <TableRow><TableCell colSpan={columns.length + 1} className="py-12 text-center text-muted-foreground">No products match this queue or filter.</TableCell></TableRow>}</TableBody></Table></div></div>;
}
