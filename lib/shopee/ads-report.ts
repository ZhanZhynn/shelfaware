import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import type { AdminDataActor } from "@/lib/admin/data-scope";
import { ADS_METRIC_VERSION, DAY_MS, additiveMetrics, calendarDate, civilDate, decimalSum, derivedAdsMetrics, object, shopContext, sumAdsMetrics, type AdsMetrics, type AdsReportType } from "./ads-metrics";

export class AdsReportError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); }
}

const reportTypes: AdsReportType[] = ["shop_cpc", "product_campaign", "shop_gmv_max"];
const unavailableFields = ["adGroupPerformance", "keywordPerformance", "locationPerformance", "addToCart", "addToCartRate", "voucherAmount", "voucheredSales"];

function readMetrics(value: unknown): AdsMetrics {
  const source = object(value);
  return Object.fromEntries(additiveMetrics.map((key) => [key, typeof source[key] === "number" && Number.isFinite(source[key]) ? source[key] : null])) as AdsMetrics;
}

function aggregate(rows: { metrics: unknown }[]) {
  const metrics = rows.map((row) => readMetrics(row.metrics));
  const knownTotals = Object.fromEntries(additiveMetrics.map((key) => {
    const known = metrics.map((row) => row[key]).filter((value): value is number => value !== null);
    return [key, known.length ? decimalSum(known) : null];
  }));
  return { ...derivedAdsMetrics(sumAdsMetrics(metrics)), knownTotals, missingMetricRows: Object.fromEntries(additiveMetrics.map((key) => [key, metrics.filter((row) => row[key] === null).length])) };
}

export async function getShopeeAdsReport(actor: AdminDataActor, params: URLSearchParams, view: string) {
  if (!["summary", "daily", "campaigns", "status"].includes(view)) throw new AdsReportError("NOT_FOUND", "Unknown ads report", 404);
  const shopId = params.get("shopId") ?? "";
  if (!/^[a-f\d]{24}$/i.test(shopId)) throw new AdsReportError("INVALID_SHOP", "An internal shopId is required");
  const ownerIds = await marketplaceOwnerIds(actor);
  const shop = await prisma.shopeeShop.findFirst({ where: { id: shopId, userId: { in: ownerIds } }, select: { id: true, shopId: true, region: true } });
  if (!shop) throw new AdsReportError("NOT_FOUND", "Shop not found", 404);
  const context = shopContext(shop.region);
  const today = civilDate(new Date(), context.timezone);
  const fromValue = params.get("dateFrom"); const toValue = params.get("dateTo");
  if (Boolean(fromValue) !== Boolean(toValue)) throw new AdsReportError("INVALID_DATE_RANGE", "dateFrom and dateTo must be provided together");
  let from: Date; let to: Date;
  try { from = fromValue ? calendarDate(fromValue) : new Date(today.getTime() - 29 * DAY_MS); to = toValue ? calendarDate(toValue) : today; }
  catch (error) { throw new AdsReportError("INVALID_DATE_RANGE", error instanceof Error ? error.message : "Invalid dates"); }
  if (from > to || to > today || to.getTime() - from.getTime() > 365 * DAY_MS) throw new AdsReportError("INVALID_DATE_RANGE", "Ads ranges must be ordered, at most 366 days, and no later than today");
  const basis = params.get("basis") ?? "campaigns";
  if (basis !== "campaigns" && basis !== "shop") throw new AdsReportError("INVALID_BASIS", "basis must be campaigns or shop");
  const [observations, imports] = await Promise.all([
    prisma.shopeeAdsObservation.findMany({ where: { shopId, reportType: { in: reportTypes }, metricVersion: ADS_METRIC_VERSION, date: { gte: from, lte: to } }, select: { entityKey: true, reportType: true, campaignId: true, date: true, metrics: true, dimensions: true, observedAt: true }, orderBy: [{ date: "asc" }, { entityKey: "asc" }], take: 50_001 }),
    prisma.shopeeAdsCoverage.findMany({ where: { shopId, metricVersion: ADS_METRIC_VERSION, dateFrom: { lte: to }, dateTo: { gte: from } }, orderBy: { observedAt: "desc" } }),
  ]);
  if (observations.length > 50_000) throw new AdsReportError("REPORT_TOO_LARGE", "Use a shorter ads date range");
  const dates: string[] = [];
  for (let value = from.getTime(); value <= to.getTime(); value += DAY_MS) dates.push(new Date(value).toISOString().slice(0, 10));
  const byType = Object.fromEntries(reportTypes.map((reportType) => {
    const missingDates = dates.filter((date) => {
      const value = calendarDate(date);
      return imports.find((record) => record.reportType === reportType && record.dateFrom <= value && record.dateTo >= value)?.state !== "observed";
    });
    return [reportType, { state: missingDates.length ? "partial" : "observed", missingDates }];
  }));
  const requiredTypes = basis === "shop" ? ["shop_cpc"] : ["product_campaign", "shop_gmv_max"];
  const relevant = observations.filter((row) => requiredTypes.includes(row.reportType));
  const normalized = relevant.map((row) => readMetrics(row.metrics));
  const warnings: string[] = [];
  const state = requiredTypes.every((kind) => byType[kind]!.state === "observed") ? "observed" : relevant.length ? "partial" : "missing";
  if (state !== "observed") warnings.push("The requested ads period has missing or incomplete imports; absent data is not zero activity.");
  if (normalized.some((row) => row.directGmv === null)) warnings.push("Direct GMV is unavailable for one or more provider rows, including Shop GMV Max; rounded ROAS is not used to invent revenue.");
  const metricAvailability = Object.fromEntries(additiveMetrics.map((key) => {
    const missingRows = normalized.filter((row) => row[key] === null).length;
    return [key, { state: !relevant.length ? "unavailable" : missingRows ? "partial" : "observed", observedRows: relevant.length - missingRows, missingRows }];
  }));
  if (normalized.some((row) => additiveMetrics.some((key) => key !== "directGmv" && row[key] === null))) warnings.push("Some source metrics are unavailable; inspect coverage.metricAvailability and null values.");
  warnings.push("Campaign discovery reflects campaigns currently discoverable through Shopee; historical completeness is not certified.");
  const report = {
    filters: { shopId, providerShopId: String(shop.shopId), dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10), basis, ...context },
    coverage: { state, reports: byType, metricAvailability, metricVersion: ADS_METRIC_VERSION, historicalCompleteness: "not_certified", unavailableFields, rounding: "Daily monetary values may differ from seller period exports due to provider rounding; discrepancies remain visible." },
    warnings,
    freshness: { latestObservedAt: relevant.length ? relevant.reduce((latest, row) => latest > row.observedAt ? latest : row.observedAt, relevant[0]!.observedAt).toISOString() : null },
  };
  if (view === "status") return { ...report, data: { ...report.coverage, observationCount: observations.length, imports: imports.map((record) => ({ reportType: record.reportType, dateFrom: record.dateFrom.toISOString().slice(0, 10), dateTo: record.dateTo.toISOString().slice(0, 10), state: record.state, diagnostics: record.diagnostics, observedAt: record.observedAt })) } };
  if (view === "summary") return { ...report, data: { basis, ...aggregate(relevant), currency: context.currency, shopTotals: aggregate(observations.filter((row) => row.reportType === "shop_cpc")), campaignTotals: aggregate(observations.filter((row) => ["product_campaign", "shop_gmv_max"].includes(row.reportType))) } };
  const groups = new Map<string, typeof relevant>();
  for (const row of relevant) {
    if (view === "campaigns" && row.reportType === "shop_cpc") continue;
    const key = view === "daily" ? row.date.toISOString().slice(0, 10) : row.entityKey;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  if (view === "campaigns" && basis === "shop") throw new AdsReportError("INVALID_BASIS", "Campaign rows require basis=campaigns");
  const data = Array.from(groups, ([key, rows]) => {
    const totals = aggregate(rows);
    if (view === "daily") return { date: key, ...totals, currency: context.currency };
    const latest = rows.reduce((a, b) => a.observedAt > b.observedAt ? a : b);
    return { entityKey: key, campaignId: latest.campaignId, reportType: latest.reportType, ...object(latest.dimensions), ...totals, currency: context.currency };
  }).filter((row) => view !== "campaigns" || additiveMetrics.some((key) => row[key] !== null && row[key]! > 0));
  if (view === "campaigns") data.sort((a, b) => (b.expense ?? -1) - (a.expense ?? -1));
  return { ...report, data, page: { total: data.length, nextCursor: null } };
}
