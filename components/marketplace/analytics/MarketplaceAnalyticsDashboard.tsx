"use client";

import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { MarketplaceStatus } from "./MarketplaceStatus";
import { MarketplaceApiError, displayPercent, displayValue, fetchMarketplaceMetric, filtersFromSearchParams, marketplaceUrlQuery, pageResultRange, type MarketplaceFiltersValue, type MarketplaceMetricResponse, type MarketplacePage, type MarketplaceShopOption, validateMarketplaceFilters, withDefaultMarketplaceShop } from "./marketplaceAnalyticsUi";

const tablePageSize = 25;
type MarketplaceMetricQuery = UseQueryResult<MarketplaceMetricResponse, Error>;

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
    },
    retry: 1,
  });
  const shops = shopsQuery.data?.shops ?? [];

  // A missing URL shop means "choose a safe default", not an implicit all-shops query.
  const draftFilters = withDefaultMarketplaceShop(draft, shops);
  const appliedFilters = withDefaultMarketplaceShop(applied, shops);
  const enabled = !shopsQuery.isLoading && shops.length > 0 && Boolean(appliedFilters.shopId || appliedFilters.allShops);
  const summaryQuery = useMetricQuery(platform, "summary", appliedFilters, enabled);
  const trendQuery = useMetricQuery(platform, "revenue-trend", appliedFilters, enabled);
  const clvQuery = useMetricQuery(platform, "clv", appliedFilters, enabled);
  const productCursor = productCursors.at(-1) ?? null;
  const buyerCursor = buyerCursors.at(-1) ?? null;
  const productsQuery = useQuery({
    queryKey: ["marketplace-analytics", "2026-analytics-v1", platform, "products", appliedFilters, productCursor, tablePageSize],
    queryFn: ({ signal }) => fetchMarketplaceMetric(platform, "products", appliedFilters, { cursor: productCursor, limit: tablePageSize }, signal),
    enabled,
    retry: 1,
  });
  const buyersQuery = useQuery({
    queryKey: ["marketplace-analytics", "2026-analytics-v1", platform, "buyers", appliedFilters, buyerCursor, tablePageSize],
    queryFn: ({ signal }) => fetchMarketplaceMetric(platform, "buyers", appliedFilters, { cursor: buyerCursor, limit: tablePageSize }, signal),
    enabled,
    retry: 1,
  });
  const apply = () => {
    const next = withDefaultMarketplaceShop(draft, shops);
    const error = validateMarketplaceFilters(next);
    if (error) return setFilterError(error);
    setFilterError(null);
    setApplied(next);
    setProductCursors([null]);
    setBuyerCursors([null]);
    const query = marketplaceUrlQuery(next);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };
  const shopsError = shopsQuery.error instanceof MarketplaceApiError ? `${shopsQuery.error.code}: ${shopsQuery.error.message}` : null;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{title} Analytics</h1><p className="text-muted-foreground">Operational order insights. Buyer identifiers are masked; financial analytics remain separately gated.</p></div>
    <MarketplaceFilters filters={draftFilters} shops={shops} shopsLoading={shopsQuery.isLoading} noShops={!shopsQuery.isLoading && shops.length === 0} error={filterError ?? shopsError} onChange={setDraft} onApply={apply} />
    {shopsQuery.isError && <PanelError error={shopsQuery.error} retry={() => shopsQuery.refetch()} />}
    {enabled && <>
      <SummaryPanel query={summaryQuery} />
      {summaryQuery.data && <MarketplaceStatus operationalCoverage={summaryQuery.data.operationalCoverage} capabilities={summaryQuery.data.capabilities} />}
      <TrendPanel query={trendQuery} />
      <ProductsPanel query={productsQuery} cursors={productCursors} onPrevious={() => setProductCursors((value) => value.slice(0, -1))} onNext={() => productsQuery.data?.page?.nextCursor && setProductCursors((value) => [...value, productsQuery.data.page.nextCursor])} />
      <BuyersPanel query={buyersQuery} cursors={buyerCursors} onPrevious={() => setBuyerCursors((value) => value.slice(0, -1))} onNext={() => buyersQuery.data?.page?.nextCursor && setBuyerCursors((value) => [...value, buyersQuery.data.page.nextCursor])} />
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
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="text-sm">{loading ? <p className="text-muted-foreground">Loading {title.toLowerCase()}...</p> : error ? <PanelError error={error} retry={retry} /> : children}</CardContent></Card>;
}

function SummaryPanel({ query }: { query: MarketplaceMetricQuery }) {
  const summary = query.data?.data as { totalOrders?: number; shopCount?: number } | undefined;
  return <Panel title="Operational summary" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><div className="grid gap-4 sm:grid-cols-2"><Metric label="Orders" value={summary?.totalOrders ?? "Unavailable"} /><Metric label="Selected shops" value={summary?.shopCount ?? "Unavailable"} /></div></Panel>;
}

function TrendPanel({ query }: { query: MarketplaceMetricQuery }) {
  const trend = (query.data?.data ?? []) as Array<{ date: string; orders: number }>;
  return <Panel title="Order trend" loading={query.isLoading} error={query.error} retry={() => query.refetch()}>{trend.length ? <ul className="space-y-1"><p className="mb-2 text-muted-foreground">Operational order count by applied period.</p>{trend.map((row) => <li key={row.date}>{row.date}: {row.orders} orders</li>)}</ul> : <p className="text-muted-foreground">No order trend is available for this selection.</p>}</Panel>;
}

function ProductsPanel({ query, cursors, onPrevious, onNext }: { query: MarketplaceMetricQuery; cursors: Array<string | null>; onPrevious: () => void; onNext: () => void }) {
  const products = (query.data?.data ?? []) as Array<{ productName: string; sku: string | null; quantity: number | null }>;
  return <Panel title="Products" loading={query.isLoading} error={query.error} retry={() => query.refetch()}>{products.length ? <><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Products for the applied analytics filters</caption><thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Quantity</th></tr></thead><tbody>{products.map((product, index) => <tr key={`${product.sku ?? product.productName}-${index}`}><td>{product.productName}</td><td>{product.sku ?? "Unavailable"}</td><td>{displayValue(product.quantity)}</td></tr>)}</tbody></table></div><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></> : <><p className="text-muted-foreground">No products are available for this selection.</p><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></>}</Panel>;
}

function BuyersPanel({ query, cursors, onPrevious, onNext }: { query: MarketplaceMetricQuery; cursors: Array<string | null>; onPrevious: () => void; onNext: () => void }) {
  const buyers = query.data?.data as { uniqueBuyers?: number | null; repeatPurchaseRate?: number | null; availabilityReason?: string | null; topBuyers?: Array<{ displayName: string | null; orders: number; historicalNetSales: number | null }> } | undefined;
  const money = (value: number | null | undefined) => displayValue(value);
  return <Panel title="Buyer activity" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><p className="mb-2 text-muted-foreground">Buyers: {displayValue(buyers?.uniqueBuyers)}; repeat purchase rate: {displayPercent(buyers?.repeatPurchaseRate)}.</p>{buyers?.topBuyers?.length ? <><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Masked buyer activity for the applied analytics filters</caption><thead><tr><th scope="col">Buyer</th><th scope="col">Orders</th><th scope="col">Historical buyer net sales</th></tr></thead><tbody>{buyers.topBuyers.map((buyer, index) => <tr key={`${buyer.displayName ?? "buyer"}-${index}`}><td>{buyer.displayName ?? "Unavailable"}</td><td>{buyer.orders}</td><td>{money(buyer.historicalNetSales)}</td></tr>)}</tbody></table></div><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></> : <><p className="text-muted-foreground">{buyers?.availabilityReason ? `Buyer activity is unavailable: ${buyers.availabilityReason.replaceAll("_", " ")}.` : "No eligible buyer activity for this selection."}</p><Pagination page={query.data?.page as MarketplacePage} canGoBack={cursors.length > 1} loading={query.isFetching} onPrevious={onPrevious} onNext={onNext} /></>}</Panel>;
}

function Pagination({ page, canGoBack, loading, onPrevious, onNext }: { page: MarketplacePage; canGoBack: boolean; loading: boolean; onPrevious: () => void; onNext: () => void }) {
  return <div className="mt-3 flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={!canGoBack || loading}>Previous page</Button><span aria-live="polite" className="text-muted-foreground">{pageResultRange(page)}</span><Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!page?.nextCursor || loading}>Next page</Button></div>;
}

function ClvPanel({ query }: { query: MarketplaceMetricQuery }) {
  const clv = query.data?.data as { summary?: { availabilityReason?: string; historicalNetSales?: number | null } } | undefined;
  return <Panel title="Predictive CLV" loading={query.isLoading} error={query.error} retry={() => query.refetch()}><p className="text-muted-foreground">Predictive CLV is unavailable{clv?.summary?.availabilityReason ? `: ${clv.summary.availabilityReason.replaceAll("_", " ")}` : "."} Historical buyer net sales is not a prediction.</p></Panel>;
}

function PlatformLimit({ platform }: { platform: MarketplacePlatform }) {
  const limits: Record<MarketplacePlatform, string> = { shopee: "Shopee finance, refund, and final escrow/shipping fields remain unavailable until the shop's granted scopes and field semantics are verified.", lazada: "Lazada quantity and finance semantics vary by region; unavailable quantities and financial categories are intentionally not estimated.", tiktok: "TikTok Shop historical finance, quantity, tax, and refund values remain unavailable until verified finance access and source fields are present.", shopify: "Shopify history, protected customer fields, returns, and payout fees depend on the shop's approved Admin API scopes." };
  return <p className="text-sm text-muted-foreground">{limits[platform]}</p>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div><p className="text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }
