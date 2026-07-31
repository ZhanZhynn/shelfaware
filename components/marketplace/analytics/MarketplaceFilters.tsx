"use client";

import { Button } from "@/components/ui/button";
import { datePresetFilters, type MarketplaceFiltersValue, type MarketplaceShopOption } from "./marketplaceAnalyticsUi";

export function MarketplaceFilters({ filters, shops, shopsLoading, noShops, error, onChange, onApply }: { filters: MarketplaceFiltersValue; shops: MarketplaceShopOption[]; shopsLoading: boolean; noShops: boolean; error: string | null; onChange: (filters: MarketplaceFiltersValue) => void; onApply: () => void }) {
  const currencies = [...new Set(shops.map((shop) => shop.currency).filter((currency): currency is string => Boolean(currency)))];
  const update = (key: keyof MarketplaceFiltersValue, value: string) => onChange({ ...filters, [key]: key === "currency" ? value.toUpperCase() : value } as MarketplaceFiltersValue);
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onApply(); }}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="grid gap-1 text-sm font-medium">Shop
          <select aria-label="Shop" className="h-11 rounded-md border bg-background px-3" value={filters.allShops ? "__all__" : filters.shopId} onChange={(event) => onChange(event.target.value === "__all__" ? { ...filters, shopId: "", allShops: true } : { ...filters, shopId: event.target.value, allShops: false })} disabled={shopsLoading || noShops}>
           <option value="__all__">{shopsLoading ? "Loading shops..." : noShops ? "No connected shops" : "All authorized shops (one source currency required)"}</option>
           {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}{shop.region ? ` (${shop.region})` : ""}{shop.currency ? ` - observed ${shop.currency}` : ""} - {shop.connectionState === "synced" ? "synced" : "not yet synced"} - ID {shop.id}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">From date<input aria-label="From date" type="date" className="h-11 rounded-md border bg-background px-3" value={filters.dateFrom} onChange={(event) => update("dateFrom", event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">To date<input aria-label="To date" type="date" className="h-11 rounded-md border bg-background px-3" value={filters.dateTo} onChange={(event) => update("dateTo", event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Currency<select aria-label="Currency" className="h-11 rounded-md border bg-background px-3" value={filters.currency} onChange={(event) => update("currency", event.target.value)}><option value="native">Native currency</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium">Trend grouping<select aria-label="Trend grouping" className="h-11 rounded-md border bg-background px-3" value={filters.granularity} onChange={(event) => update("granularity", event.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
    </div>
    <fieldset className="flex flex-wrap items-center gap-2" aria-label="Date presets"><legend className="mr-1 text-sm font-medium">Date presets</legend>{(["7", "30", "90", "all"] as const).map((preset) => <Button key={preset} type="button" variant="outline" size="sm" onClick={() => onChange(datePresetFilters(filters, preset))}>{preset === "all" ? "All available" : `Last ${preset} days`}</Button>)}</fieldset>
    {noShops && <p className="text-sm text-muted-foreground">Connect a {"marketplace"} shop to view analytics.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={shopsLoading || noShops}>Apply filters</Button>
  </form>;
}
