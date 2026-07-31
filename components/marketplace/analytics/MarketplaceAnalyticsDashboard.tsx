"use client";

import { useState, useId } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Package, ShoppingBag, Store, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { MarketplaceStatus } from "./MarketplaceStatus";
import { MarketplaceApiError, displayPercent, displayValue, fetchMarketplaceMetric, filtersFromSearchParams, marketplaceUrlQuery, pageResultRange, type MarketplaceFiltersValue, type MarketplaceMetricResponse, type MarketplacePage, type MarketplaceShopOption, validateMarketplaceFilters, withDefaultMarketplaceShop } from "./marketplaceAnalyticsUi";

const tablePageSize = 25;
type MarketplaceMetricQuery = UseQueryResult<MarketplaceMetricResponse, Error>;
type Summary = { totalOrders?: number; operationalOrderCount?: number; operationalCurrency?: string; operationalSales?: number | null; averageOrderValue?: number | null; shopCount?: number };

function useMetricQuery(platform: MarketplacePlatform, metric: "summary" | "revenue-trend" | "clv", filters: MarketplaceFiltersValue, enabled: boolean) {
  return useQuery<MarketplaceMetricResponse>({ queryKey: ["marketplace-analytics", "2026-analytics-v1", platform, metric, filters], queryFn: ({ signal }) => fetchMarketplaceMetric(platform, metric, filters, undefined, signal), enabled, retry: 1 });
}

export function MarketplaceAnalyticsDashboard({ platform, title }: { platform: MarketplacePlatform; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<MarketplaceFiltersValue>(() => filtersFromSearchParams(searchParams));
  const [applied, setApplied] = useState<MarketplaceFiltersValue>(() => filtersFromSearchParams(searchParams));
  const [filterError, setFilterError] = useState<string | null>(null);
  const [productCursors, setProductCursors] = useState<Array<string | null>>([null]);
  const [buyerCursors, setBuyerCursors] = useState<Array<string | null>>([null]);
  const shopsQuery = useQuery<{ shops: MarketplaceShopOption[] }>({
    queryKey: ["marketplace-shops", platform],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/marketplace/shops?platform=${platform}`, { signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new MarketplaceApiError(body?.error?.code ?? String(response.status), body?.error?.message ?? `Request failed with status ${response.status}`);
      return body;
    }, retry: 1,
  });
  const shops = shopsQuery.data?.shops ?? [];
  const draftFilters = withDefaultMarketplaceShop(draft, shops);
  const appliedFilters = withDefaultMarketplaceShop(applied, shops);
  const enabled = !shopsQuery.isLoading && shops.length > 0 && Boolean(appliedFilters.shopId || appliedFilters.allShops);
  const summaryQuery = useMetricQuery(platform, "summary", appliedFilters, enabled);
  const trendQuery = useMetricQuery(platform, "revenue-trend", appliedFilters, enabled);
  const clvQuery = useMetricQuery(platform, "clv", appliedFilters, enabled);
  const productCursor = productCursors.at(-1) ?? null;
  const buyerCursor = buyerCursors.at(-1) ?? null;
  const productsQuery = useQuery<MarketplaceMetricResponse>({ queryKey: ["marketplace-analytics", "2026-analytics-v1", platform, "products", appliedFilters, productCursor, tablePageSize], queryFn: ({ signal }) => fetchMarketplaceMetric(platform, "products", appliedFilters, { cursor: productCursor, limit: tablePageSize }, signal), enabled, retry: 1 });
  const buyersQuery = useQuery<MarketplaceMetricResponse>({ queryKey: ["marketplace-analytics", "2026-analytics-v1", platform, "buyers", appliedFilters, buyerCursor, tablePageSize], queryFn: ({ signal }) => fetchMarketplaceMetric(platform, "buyers", appliedFilters, { cursor: buyerCursor, limit: tablePageSize }, signal), enabled, retry: 1 });
  const apply = (requestedFilters = draft) => {
    const next = withDefaultMarketplaceShop(requestedFilters, shops);
    const error = validateMarketplaceFilters(next);
    if (error) return setFilterError(error);
    setFilterError(null); setApplied(next); setProductCursors([null]); setBuyerCursors([null]);
    const query = marketplaceUrlQuery(next);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };
  const shopsError = shopsQuery.error instanceof MarketplaceApiError ? `${shopsQuery.error.code}: ${shopsQuery.error.message}` : null;
  const summary = summaryQuery.data?.data as Summary | undefined;
  const currency = summary?.operationalCurrency ?? undefined;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{title} Analytics</h1><p className="text-muted-foreground">Observed order performance. Financial profit is shown only after marketplace reconciliation.</p></div>
    <MarketplaceFilters filters={draftFilters} shops={shops} shopsLoading={shopsQuery.isLoading} noShops={!shopsQuery.isLoading && shops.length === 0} error={filterError ?? shopsError} onChange={setDraft} onApply={apply} />
    {shopsQuery.isError && <PanelError error={shopsQuery.error} retry={() => shopsQuery.refetch()} />}
    {enabled && <>
      <SummaryPanel query={summaryQuery} />
      {summaryQuery.data && <MarketplaceStatus operationalCoverage={summaryQuery.data.operationalCoverage} capabilities={summaryQuery.data.capabilities} />}
      <TrendPanel query={trendQuery} currency={currency} />
      <ProductsPanel query={productsQuery} currency={currency} cursors={productCursors} onPrevious={() => setProductCursors((value) => value.slice(0, -1))} onNext={() => { const nextCursor = productsQuery.data?.page?.nextCursor; if (nextCursor) setProductCursors((value) => [...value, nextCursor]); }} />
      <BuyersPanel query={buyersQuery} cursors={buyerCursors} onPrevious={() => setBuyerCursors((value) => value.slice(0, -1))} onNext={() => { const nextCursor = buyersQuery.data?.page?.nextCursor; if (nextCursor) setBuyerCursors((value) => [...value, nextCursor]); }} />
      <ClvPanel query={clvQuery} />
      <PlatformLimit platform={platform} />
    </>}
  </div>;
}

function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof MarketplaceApiError ? `${error.code}: ${error.message}` : "Unable to load this panel.";
  return <div role="alert" className="space-y-2 text-sm text-destructive"><p>{message}</p><Button type="button" variant="outline" size="sm" onClick={retry}>Retry panel</Button></div>;
}

function Panel({ title, loading, error, retry, children }: { title: string; loading: boolean; error: unknown; retry: () => void; children: React.ReactNode }) {
  return <Card className="border-border/50 bg-gradient-to-br from-card to-card/50 backdrop-blur-sm"><CardHeader><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader><CardContent className="text-sm">{loading ? <p className="text-muted-foreground">Loading {title.toLowerCase()}...</p> : error ? <PanelError error={error} retry={retry} /> : children}</CardContent></Card>;
}

function SummaryPanel({ query }: { query: MarketplaceMetricQuery }) {
  const summary = query.data?.data as Summary | undefined;
  const cards = [
    { label: "Observed order value", value: operationalMoney(summary?.operationalSales, summary?.operationalCurrency), icon: TrendingUp, tone: "text-amber-500", background: "bg-amber-500/10" },
    { label: "Active orders", value: displayValue(summary?.operationalOrderCount), icon: ShoppingBag, tone: "text-emerald-500", background: "bg-emerald-500/10" },
    { label: "Average order value", value: operationalMoney(summary?.averageOrderValue, summary?.operationalCurrency), icon: TrendingUp, tone: "text-violet-500", background: "bg-violet-500/10" },
    { label: "Selected shops", value: displayValue(summary?.shopCount), icon: Store, tone: "text-blue-500", background: "bg-blue-500/10" },
  ];
  return <Panel title="Operational overview" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <div key={card.label} className="rounded-lg border border-border/50 bg-background/40 p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{card.label}</p><p className="mt-1 text-2xl font-bold">{card.value}</p></div><div className={`rounded-lg p-2 ${card.background}`}><card.icon className={`h-5 w-5 ${card.tone}`} /></div></div></div>)}</div><p className="mt-4 text-xs text-muted-foreground">Observed order value excludes cancelled orders. It is not a settled payout or profit figure.</p></Panel>;
}

function TrendPanel({ query, currency }: { query: MarketplaceMetricQuery; currency?: string }) {
  const trend = (query.data?.data ?? []) as Array<{ date: string; orders: number; operationalSales: number | null }>;
  const gradientId = useId();
  return <Panel title="Order value trend" loading={query.isLoading} error={query.error} retry={() => query.refetch()}>{trend.length ? <ResponsiveContainer width="100%" height={270}><AreaChart data={trend} margin={{ top: 8, right: 10, left: 8, bottom: 0 }}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} /><stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" className="stroke-muted" /><XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => compactNumber(value)} /><Tooltip formatter={(value) => [operationalMoney(Number(value), currency), "Observed order value"]} labelFormatter={(label) => String(label)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} /><Area type="monotone" dataKey="operationalSales" stroke="#0ea5e9" strokeWidth={2} fill={`url(#${gradientId})`} /></AreaChart></ResponsiveContainer> : <EmptyState label="No observed orders match this date range." />}</Panel>;
}

function ProductsPanel({ query, currency, cursors, onPrevious, onNext }: { query: MarketplaceMetricQuery; currency?: string; cursors: Array<string | null>; onPrevious: () => void; onNext: () => void }) {
  const products = (query.data?.data ?? []) as Array<{ productName: string; sku: string | null; imageUrl: string | null; quantity: number | null; operationalSales: number | null }>;
  return <Panel title="Product performance" loading={query.isLoading} error={query.error} retry={() => query.refetch()}>{products.length ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{products.map((product, index) => <div key={`${product.sku ?? product.productName}-${index}`} className="flex gap-3 rounded-lg border border-border/50 bg-background/40 p-3"><ProductImage src={product.imageUrl} name={product.productName} /><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.productName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{product.sku ?? "No SKU recorded"}</p><div className="mt-3 flex items-end justify-between gap-2"><div><p className="text-xs text-muted-foreground">Units sold</p><p className="font-semibold">{displayValue(product.quantity)}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">Order value</p><p className="font-semibold">{operationalMoney(product.operationalSales, currency)}</p></div></div></div></div>)}</div><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></> : <><EmptyState label="No products are available for this selection." /><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></>}</Panel>;
}

function ProductImage({ src, name }: { src: string | null; name: string }) {
  return <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Package aria-label={`${name} image unavailable`} className="h-5 w-5 text-muted-foreground" />}</div>;
}

function BuyersPanel({ query, cursors, onPrevious, onNext }: { query: MarketplaceMetricQuery; cursors: Array<string | null>; onPrevious: () => void; onNext: () => void }) {
  const buyers = query.data?.data as { uniqueBuyers?: number | null; repeatPurchaseRate?: number | null; availabilityReason?: string | null; topBuyers?: Array<{ displayName: string | null; orders: number }> } | undefined;
  return <Panel title="Buyer activity" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Unique buyers</p><p className="mt-1 text-2xl font-bold">{displayValue(buyers?.uniqueBuyers)}</p></div><div className="rounded-lg bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Repeat purchase rate</p><p className="mt-1 text-2xl font-bold">{displayPercent(buyers?.repeatPurchaseRate)}</p></div></div>{buyers?.topBuyers?.length ? <><div className="mt-4 flex flex-wrap gap-2">{buyers.topBuyers.map((buyer, index) => <Badge key={`${buyer.displayName ?? "buyer"}-${index}`} variant="secondary">{buyer.displayName ?? "Buyer"}: {buyer.orders} orders</Badge>)}</div><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></> : <><p className="mt-4 text-muted-foreground">{buyers?.availabilityReason ? `Buyer details are unavailable: ${buyers.availabilityReason.replaceAll("_", " ")}.` : "No eligible buyer activity for this selection."}</p><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></>}</Panel>;
}

function Pagination({ page, canGoBack, loading, onPrevious, onNext }: { page: MarketplacePage; canGoBack: boolean; loading: boolean; onPrevious: () => void; onNext: () => void }) {
  return <div className="mt-4 flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={!canGoBack || loading}>Previous</Button><span aria-live="polite" className="text-muted-foreground">{pageResultRange(page)}</span><Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!page?.nextCursor || loading}>Next</Button></div>;
}

function ClvPanel({ query }: { query: MarketplaceMetricQuery }) {
  const clv = query.data?.data as { summary?: { availabilityReason?: string } } | undefined;
  return <Panel title="Predictive customer value" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><p className="text-muted-foreground">Predictive customer value remains unavailable{clv?.summary?.availabilityReason ? `: ${clv.summary.availabilityReason.replaceAll("_", " ")}` : ""}. Historical sales are not presented as a prediction.</p></Panel>;
}

function PlatformLimit({ platform }: { platform: MarketplacePlatform }) {
  const limits: Record<MarketplacePlatform, string> = { shopee: "Shopee finance, refund, and final escrow/shipping fields remain unavailable until the shop's granted scopes and field semantics are verified.", lazada: "Lazada finance categories vary by region; costs and payouts are intentionally not estimated.", tiktok: "TikTok Shop taxes, refunds, and payouts remain unavailable until verified finance access and source fields are present.", shopify: "Shopify returns and payout fees depend on the shop's approved Admin API scopes." };
  return <p className="text-sm text-muted-foreground">{limits[platform]}</p>;
}

function EmptyState({ label }: { label: string }) { return <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">{label}</div>; }

function compactNumber(value: number) { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function operationalMoney(value: number | null | undefined, currency?: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  if (!currency || currency === "unknown") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
}
