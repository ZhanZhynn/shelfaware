"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";
import type { MarketplaceFiltersValue, MarketplaceShopOption } from "./marketplaceAnalyticsUi";

const subscribe = () => () => {};
const datePresets = [{ label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "6M", days: 180 }, { label: "1Y", days: 365 }] as const;

export function MarketplaceFilters({ filters, shops, shopsLoading, noShops, error, onChange, onApply }: { filters: MarketplaceFiltersValue; shops: MarketplaceShopOption[]; shopsLoading: boolean; noShops: boolean; error: string | null; onChange: (filters: MarketplaceFiltersValue) => void; onApply: (filters: MarketplaceFiltersValue) => void }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  // React Query may have browser-cached shops before hydration; defer them so SSR matches.
  const visibleShops = hydrated ? shops : [];
  const visibleNoShops = hydrated && noShops;
  const visibleShopsLoading = !hydrated || shopsLoading;
  const currencies = [...new Set(visibleShops.map((shop) => shop.currency).filter((currency): currency is string => Boolean(currency)))];
  const update = (key: keyof MarketplaceFiltersValue, value: string) => onChange({ ...filters, [key]: key === "currency" ? value.toUpperCase() : value } as MarketplaceFiltersValue);
  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    const next = { ...filters, dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
    setActivePreset(days);
    onChange(next);
    onApply(next);
  };
  const clearDates = () => {
    const next = { ...filters, dateFrom: "", dateTo: "" };
    setActivePreset(null);
    onChange(next);
    onApply(next);
  };
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onApply(filters); }}>
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/50 px-3 py-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      {datePresets.map((preset) => <Button key={preset.days} type="button" variant={activePreset === preset.days ? "default" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => applyPreset(preset.days)}>{preset.label}</Button>)}
      <div className="flex flex-wrap items-center gap-1 sm:ml-2">
        <Input aria-label="From date" type="date" className="h-7 w-[130px] text-xs" value={filters.dateFrom} onChange={(event) => { setActivePreset(null); update("dateFrom", event.target.value); }} />
        <span className="text-muted-foreground">-</span>
        <Input aria-label="To date" type="date" className="h-7 w-[130px] text-xs" value={filters.dateTo} onChange={(event) => { setActivePreset(null); update("dateTo", event.target.value); }} />
        <Button type="submit" variant="outline" size="sm" className="h-7 text-xs" disabled={visibleShopsLoading || visibleNoShops}>Apply</Button>
        {(filters.dateFrom || filters.dateTo) && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearDates}>Clear</Button>}
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-sm font-medium">Shop
          <select aria-label="Shop" className="h-11 rounded-md border bg-background px-3" value={filters.allShops ? "__all__" : filters.shopId} onChange={(event) => onChange(event.target.value === "__all__" ? { ...filters, shopId: "", allShops: true } : { ...filters, shopId: event.target.value, allShops: false })} disabled={visibleShopsLoading || visibleNoShops}>
            <option value="__all__">{visibleShopsLoading ? "Loading shops..." : visibleNoShops ? "No connected shops" : "All authorized shops (one source currency required)"}</option>
            {visibleShops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}{shop.region ? ` (${shop.region})` : ""}{shop.currency ? ` - observed ${shop.currency}` : ""} - {shop.connectionState === "synced" ? "synced" : "not yet synced"} - ID {shop.id}</option>)}
         </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Currency<select aria-label="Currency" className="h-11 rounded-md border bg-background px-3" value={filters.currency} onChange={(event) => update("currency", event.target.value)}><option value="native">Native currency</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium">Trend grouping<select aria-label="Trend grouping" className="h-11 rounded-md border bg-background px-3" value={filters.granularity} onChange={(event) => update("granularity", event.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
    </div>
    {visibleNoShops && <p className="text-sm text-muted-foreground">Connect a {"marketplace"} shop to view analytics.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
