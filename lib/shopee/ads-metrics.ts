/** Shopee seller-report metrics; counts and conversion rates are different fields. */
export const ADS_METRIC_VERSION = "2026-shopee-ads-v1";
export const DAY_MS = 86_400_000;
export const additiveMetrics = ["impressions", "clicks", "conversions", "directConversions", "itemsSold", "directItemsSold", "gmv", "directGmv", "expense"] as const;
export type AdsMetric = typeof additiveMetrics[number];
export type AdsMetrics = Record<AdsMetric, number | null>;
export type AdsReportType = "shop_cpc" | "product_campaign" | "shop_gmv_max";

export class AdsDataError extends Error {}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdsDataError("Expected a provider object");
  return value as Record<string, unknown>;
}

export function providerSections(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).map(object);
}

export function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AdsDataError("Dates must be YYYY-MM-DD calendar dates");
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AdsDataError("Invalid calendar date");
  return date;
}

export function providerDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{2}-\d{2}-\d{4}$/.test(value)) throw new AdsDataError("Invalid provider ads date");
  return calendarDate(value.slice(6) + "-" + value.slice(3, 5) + "-" + value.slice(0, 2));
}

export function shopeeDate(date: Date) {
  return date.toISOString().slice(0, 10).split("-").reverse().join("-");
}

export function shopContext(region: string | null | undefined) {
  const values: Record<string, [string, string]> = { MY: ["Asia/Kuala_Lumpur", "MYR"], SG: ["Asia/Singapore", "SGD"], TH: ["Asia/Bangkok", "THB"], VN: ["Asia/Ho_Chi_Minh", "VND"], ID: ["Asia/Jakarta", "IDR"], PH: ["Asia/Manila", "PHP"], TW: ["Asia/Taipei", "TWD"], BR: ["America/Sao_Paulo", "BRL"] };
  const found = values[region?.toUpperCase() ?? ""];
  return { timezone: found?.[0] ?? "UTC", currency: found?.[1] ?? null, currencySource: found ? "shop_region" : "unavailable" };
}

export function civilDate(instant: Date, timezone: string) {
  return calendarDate(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant));
}

/** Inclusive, non-overlapping provider windows; a one-day tail is not dropped. */
export function adsWindows(from: Date, to: Date) {
  const windows: { from: Date; to: Date }[] = [];
  for (let day = from.getTime(); day <= to.getTime(); day += 28 * DAY_MS) {
    windows.push({ from: new Date(day), to: new Date(Math.min(day + 27 * DAY_MS, to.getTime())) });
  }
  return windows;
}

/** The CPC APIs reject equal dates. Fetch context and retain only the requested day. */
export function cpcWindow(from: Date, to: Date, today: Date) {
  if (from.getTime() !== to.getTime()) return { from, to };
  return to < today ? { from, to: new Date(to.getTime() + DAY_MS) } : { from: new Date(from.getTime() - DAY_MS), to };
}

function numeric(row: Record<string, unknown>, aliases: string[], integer: boolean): number | null {
  for (const key of aliases) {
    const value = row[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (integer && !Number.isSafeInteger(number))) return null;
    return number;
  }
  return null;
}

export function normalizeAdsMetrics(row: Record<string, unknown>): AdsMetrics {
  return {
    impressions: numeric(row, ["impression"], true), clicks: numeric(row, ["clicks"], true),
    // *_conversions on the shop endpoint are RATES, not conversion counts.
    conversions: numeric(row, ["broad_order"], true), directConversions: numeric(row, ["direct_order"], true),
    itemsSold: numeric(row, ["broad_order_amount", "broad_item_sold"], true),
    directItemsSold: numeric(row, ["direct_order_amount", "direct_item_sold"], true),
    gmv: numeric(row, ["broad_gmv"], false), directGmv: numeric(row, ["direct_gmv"], false),
    expense: numeric(row, ["expense"], false),
  };
}

/** Sum provider decimals using integer decimal arithmetic, not float accumulation. */
export function decimalSum(values: number[]): number | null {
  if (!values.length) return 0;
  const parts = values.map((value) => {
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
    if (!match) throw new AdsDataError("Invalid non-negative provider number");
    const fraction = match[2] ?? "";
    const scale = fraction.length - Number(match[3] ?? 0);
    return { digits: BigInt(match[1]! + fraction), scale };
  });
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const total = parts.reduce((sum, part) => sum + part.digits * 10n ** BigInt(scale - part.scale), 0n);
  const digits = total.toString().padStart(scale + 1, "0");
  const result = Number(scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits);
  return Number.isFinite(result) && result <= Number.MAX_SAFE_INTEGER ? result : null;
}

export function sumAdsMetrics(rows: AdsMetrics[]): AdsMetrics {
  return Object.fromEntries(additiveMetrics.map((key) => [key, !rows.length || rows.some((row) => row[key] === null) ? null : decimalSum(rows.map((row) => row[key]!))])) as AdsMetrics;
}

export function derivedAdsMetrics(metrics: AdsMetrics) {
  const ratio = (numerator: number | null, denominator: number | null, factor = 1) => numerator !== null && denominator !== null && denominator > 0 ? Math.round(numerator / denominator * factor * 1e6) / 1e6 : null;
  return { ...metrics, ctr: ratio(metrics.clicks, metrics.impressions, 100), conversionRate: ratio(metrics.conversions, metrics.clicks, 100), directConversionRate: ratio(metrics.directConversions, metrics.clicks, 100), costPerClick: ratio(metrics.expense, metrics.clicks), costPerConversion: ratio(metrics.expense, metrics.conversions), costPerDirectConversion: ratio(metrics.expense, metrics.directConversions), roas: ratio(metrics.gmv, metrics.expense), directRoas: ratio(metrics.directGmv, metrics.expense), acos: ratio(metrics.expense, metrics.gmv, 100), directAcos: ratio(metrics.expense, metrics.directGmv, 100) };
}

export function meaningfulMetrics(metrics: AdsMetrics) {
  return additiveMetrics.some((key) => metrics[key] !== null && metrics[key]! > 0);
}

export function safeAdsError(error: unknown) {
  if (error instanceof Error && /^(Mongo|Prisma)/.test(error.name)) return "ADS_STORAGE_FAILED";
  const text = error instanceof Error ? error.message : String(error);
  const code = /(?:"error"\s*:\s*"|\b)(ads\.[A-Za-z0-9_.]+|error_[A-Za-z0-9_]+)\b/.exec(text)?.[1];
  return code ?? (error instanceof AdsDataError ? "ADS_RESPONSE_INVALID" : "ADS_PROVIDER_REQUEST_FAILED");
}
