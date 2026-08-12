"use client";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type Money = { minorUnits: string; scale: number };
type ConversionCoverage = {
  convertedCount: number;
  identityCount: number;
  excludedCount: number;
  excludedCurrencies: Record<string, { count: number; nativeMinorTotal: string }>;
  fallbackTypeDistribution: Record<string, number>;
};
type Report = {
  rows: { salesSkuId: string; salesSkuCode: string; familyId: string | null; familyName: string | null; offerUnits: number; baseEquivalentUnits: number; nativeRevenueByCurrency: Record<string, Money> }[];
  familyRows: { familyId: string; familyName: string; offerUnits: number; baseEquivalentUnits: number; nativeRevenueByCurrency: Record<string, Money>; mixedRecipeLines: number }[];
  reportingCurrency?: string | null;
  convertedRevenue?: Money;
  conversionCoverage?: ConversionCoverage;
  coverage: { totalReliableShopeeLines: number; mappedLines: number; unverifiableLegacyLines: number; familyAttributionExcludedLines: number; recipeCoveredLines: number; mixedRecipeLines: number; excludedPlatforms: string[]; reportingCurrency?: string | null; note: string };
};

export default function CrossChannelPerformance() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reportingCurrency, setReportingCurrency] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 29); setFrom(start.toISOString().slice(0, 10)); setTo(end.toISOString().slice(0, 10)); }); return () => window.clearTimeout(timer); }, []);
  const query = useQuery({
    queryKey: ["crossChannelPerformance", from, to, reportingCurrency],
    enabled: Boolean(from && to),
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to });
      if (reportingCurrency) params.set("reportingCurrency", reportingCurrency);
      return (await axios.get(`/api/inventory/cross-channel-performance?${params}`, { withCredentials: true })).data as Report;
    },
  });
  const formatMoney = (currency: string, value: Money) => `${currency} ${(Number(value.minorUnits) / 10 ** value.scale).toFixed(value.scale)}`;
  const native = (values: Record<string, Money>) => Object.entries(values).map(([currency, value]) => formatMoney(currency, value)).join(", ");
  if (query.isLoading) return <section className="h-28 animate-pulse rounded-lg bg-muted" />;
  if (query.error || !query.data) return <section className="rounded-lg border p-4 text-sm text-destructive">Cross-channel performance is currently unavailable.</section>;
  const report = query.data;
  const totalLines = (report.conversionCoverage?.convertedCount ?? 0) + (report.conversionCoverage?.excludedCount ?? 0);
  const coveragePct = totalLines > 0 ? ((report.conversionCoverage?.convertedCount ?? 0) / totalLines * 100).toFixed(1) : "0.0";
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Cross-channel performance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Confirmed Shopee mappings only. {report.coverage.note}</p>
        </div>
        <div className="flex gap-2">
          <Input aria-label="Performance from" className="w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input aria-label="Performance to" className="w-36" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input aria-label="Reporting currency" className="w-24" placeholder="e.g. MYR" value={reportingCurrency} onChange={(e) => setReportingCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {report.coverage.mappedLines}/{report.coverage.totalReliableShopeeLines} verifiable lines mapped; {report.coverage.unverifiableLegacyLines} legacy lines excluded because their identity cannot be verified; {report.coverage.familyAttributionExcludedLines} mapped lines excluded from family rollups because no effective family membership covers their sale date; {report.coverage.recipeCoveredLines} safely recipe-normalized; {report.coverage.mixedRecipeLines} mixed-recipe lines excluded. {report.coverage.excludedPlatforms.join(" and ")} are unavailable because line semantics are not verified.
      </p>
      {report.reportingCurrency && report.convertedRevenue && report.conversionCoverage && (
        <div className="mt-2 rounded bg-blue-50 p-2 text-sm dark:bg-blue-950">
          <strong>Converted total ({report.reportingCurrency}):</strong> {formatMoney(report.reportingCurrency, report.convertedRevenue)}
          <span className="ml-2 text-muted-foreground">
            {report.conversionCoverage.convertedCount} of {totalLines} lines converted ({coveragePct}% coverage)
          </span>
          {report.conversionCoverage.excludedCount > 0 && (
            <span className="ml-2 text-destructive">
              {report.conversionCoverage.excludedCount} excluded: {Object.entries(report.conversionCoverage.excludedCurrencies).map(([currency, info]) => `${info.count} ${currency} lines (${formatMoney(currency, { minorUnits: info.nativeMinorTotal, scale: 2 })})`).join(", ")}
            </span>
          )}
          {report.conversionCoverage.identityCount === report.conversionCoverage.convertedCount ? (
            <span className="ml-2 text-muted-foreground">
              All revenue was already in {report.reportingCurrency}; no exchange rates were needed.
            </span>
          ) : Object.entries(report.conversionCoverage.fallbackTypeDistribution).filter(([, count]) => count > 0).length > 0 && (
            <span className="ml-2 text-muted-foreground">
              Rate sources: {Object.entries(report.conversionCoverage.fallbackTypeDistribution).filter(([, count]) => count > 0).map(([type, count]) => `${count} ${type}`).join(", ")}
            </span>
          )}
        </div>
      )}
      <div className="mt-3 space-y-2 text-sm">
        <h3 className="font-medium">Offer / Sales SKU</h3>
        {report.rows.map((row) => (
          <div key={`${row.salesSkuId}:${row.familyId ?? "unassigned"}`} className="rounded bg-muted p-2">
            <strong>{row.salesSkuCode}</strong> ({row.familyName ?? "No effective family membership"}): {row.offerUnits} sellable units, {row.baseEquivalentUnits} base-equivalent units, native revenue {native(row.nativeRevenueByCurrency)}
          </div>
        ))}
        <h3 className="pt-2 font-medium">Product family</h3>
        {report.familyRows.map((row) => (
          <div key={row.familyId} className="rounded bg-muted p-2">
            <strong>{row.familyName}</strong>: {row.offerUnits} offer units, {row.baseEquivalentUnits} base-equivalent units, {row.mixedRecipeLines} mixed recipe lines excluded, native offer revenue {native(row.nativeRevenueByCurrency)}
          </div>
        ))}
      </div>
    </section>
  );
}
