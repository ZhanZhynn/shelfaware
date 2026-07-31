import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

export type MarketplaceFiltersValue = { shopId: string; allShops: boolean; dateFrom: string; dateTo: string; currency: string; granularity: "day" | "week" | "month" };
export type MarketplaceShopOption = { id: string; platform: MarketplacePlatform; displayName: string; region: string | null; currency: string | null; connectionState: "synced" | "not-yet-synced"; lastSyncedAt: string | null };
export type MarketplacePage = { limit: number; cursor: string | null; nextCursor: string | null; total: number } | null;
export type OperationalCoverage = { state?: string; availability?: string; reason?: string | null; observedDateRange?: { from: string; to: string } | null; rawOrderCount?: number; rawItemCount?: number; unknownStatusCount?: number; unknownQuantityCount?: number; unknownIdentityCount?: number; sourceCurrencies?: string[] };
export type FinancialCoverage = { state?: string; calculationBasis?: string; financialCoveragePercent?: number | null; buyerIdentityCoveragePercent?: number | null; missingCostCategories?: string[]; conversion?: { sourceCurrencies?: string[]; applied?: boolean }; unavailableReasons?: string[]; rawOrderCount?: number; certifiedOrderCount?: number; reportingCurrency?: string; exclusions?: string[] };
export type MarketplaceMetricResponse = { data: unknown; operationalCoverage?: OperationalCoverage; financialCoverage?: FinancialCoverage; capabilities?: Record<string, string>; page?: MarketplacePage };

/** Reporting currency belongs to the financial contract, never operational coverage. */
export function financialReportingCurrency(response: Pick<MarketplaceMetricResponse, "financialCoverage">) {
  const currency = response.financialCoverage?.reportingCurrency;
  return currency === "unknown" ? undefined : currency;
}

export const defaultMarketplaceFilters: MarketplaceFiltersValue = { shopId: "", allShops: false, dateFrom: "", dateTo: "", currency: "native", granularity: "day" };

export function filtersFromSearchParams(params: URLSearchParams): MarketplaceFiltersValue {
  const granularity = params.get("granularity");
  return { shopId: params.get("shopId") ?? "", allShops: params.get("allShops") === "1", dateFrom: params.get("dateFrom") ?? "", dateTo: params.get("dateTo") ?? "", currency: params.get("currency") ?? "native", granularity: granularity === "week" || granularity === "month" ? granularity : "day" };
}

export function withDefaultMarketplaceShop(filters: MarketplaceFiltersValue, shops: Pick<MarketplaceShopOption, "id">[]): MarketplaceFiltersValue {
  return filters.shopId || filters.allShops || shops.length === 0 ? filters : { ...filters, shopId: shops[0]?.id ?? "" };
}

function isUtcCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateMarketplaceFilters(filters: MarketplaceFiltersValue): string | null {
  if (filters.dateFrom && !isUtcCalendarDate(filters.dateFrom)) return "Start date must be a valid calendar date.";
  if (filters.dateTo && !isUtcCalendarDate(filters.dateTo)) return "End date must be a valid calendar date.";
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) return "Start date cannot be after end date.";
  if (filters.currency !== "native" && !/^[A-Z]{3}$/.test(filters.currency)) return "Currency must be a three-letter ISO code.";
  return null;
}

export function marketplaceFilterQuery(filters: MarketplaceFiltersValue, includeGranularity = false): string {
  const params = new URLSearchParams();
  if (filters.shopId) params.set("shopId", filters.shopId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.currency !== "native") params.set("currency", filters.currency);
  if (includeGranularity) params.set("granularity", filters.granularity);
  return params.toString();
}

export function marketplaceUrlQuery(filters: MarketplaceFiltersValue) {
  const params = new URLSearchParams(marketplaceFilterQuery(filters, filters.granularity !== "day"));
  if (filters.allShops) params.set("allShops", "1");
  return params.toString();
}

export function datePresetFilters(filters: MarketplaceFiltersValue, preset: "7" | "30" | "90" | "all", now = new Date()): MarketplaceFiltersValue {
  if (preset === "all") return { ...filters, dateFrom: "", dateTo: "" };
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (Number(preset) - 1));
  return { ...filters, dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}

export function pageResultRange(page: MarketplacePage) {
  if (!page || page.total === 0) return "0 results";
  let offset = 0;
  if (page.cursor) {
    const decoded = atob(page.cursor.replace(/-/g, "+").replace(/_/g, "/")).replace(/\0+$/, "");
    const match = /^offset:(\d+)$/.exec(decoded);
    if (match) offset = Number(match[1]);
  }
  return `${offset + 1}-${Math.min(offset + page.limit, page.total)} of ${page.total}`;
}

export class MarketplaceApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function fetchMarketplaceMetric(platform: MarketplacePlatform, metric: string, filters: MarketplaceFiltersValue, page?: { cursor?: string | null; limit?: number }, signal?: AbortSignal) {
  const query = marketplaceFilterQuery(filters, metric === "revenue-trend");
  const params = new URLSearchParams(query);
  params.set("apiVersion", "2026-analytics-v1");
  if (page?.cursor) params.set("cursor", page.cursor);
  if (page?.limit) params.set("limit", String(page.limit));
  const path = metric === "summary" ? `/api/${platform}/stats` : `/api/${platform}/stats/${metric}`;
  const response = await fetch(`${path}${params.size ? `?${params}` : ""}`, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new MarketplaceApiError(body?.error?.code ?? String(response.status), body?.error?.message ?? `Request failed with status ${response.status}`);
  return body;
}

export function displayValue(value: number | null | undefined, format?: (value: number) => string) {
  return typeof value === "number" && Number.isFinite(value) ? format?.(value) ?? String(value) : "Unavailable";
}

export function displayPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "Unavailable";
}
