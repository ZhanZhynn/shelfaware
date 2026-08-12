import { getExchangeRateForDate, refreshExchangeRate, type HistoricalRateSelection } from "@/lib/exchange-rates/service";
import { convertMoney } from "@/lib/money";

export type ConversionResult =
  | { reportingMinor: bigint; rateDate: Date; rateProvider: string; fallbackType: HistoricalRateSelection; excluded?: false }
  | { excluded: true; reason: string };

export type ConversionCoverage = {
  convertedCount: number;
  identityCount: number;
  excludedCount: number;
  excludedCurrencies: Record<string, { count: number; nativeMinorTotal: bigint }>;
  fallbackTypeDistribution: Record<HistoricalRateSelection, number>;
};

export type AggregatedConversion = {
  reportingMinorTotal: bigint;
  coverage: ConversionCoverage;
};

const currencyScale = (currency: string) =>
  ({ JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3 }[currency.toUpperCase()] ?? 2);

function nativeToMajor(nativeMinor: bigint, currency: string): number {
  const scale = currencyScale(currency);
  return Number(nativeMinor) / 10 ** scale;
}

function majorToNative(major: number, currency: string): bigint {
  const scale = currencyScale(currency);
  return BigInt(Math.round(major * 10 ** scale));
}

export async function convertNativeToReporting(
  nativeMinor: bigint,
  currency: string,
  saleDate: Date,
  reportingCurrency: string,
): Promise<ConversionResult> {
  const normalizedSource = currency.trim().toUpperCase();
  const normalizedTarget = reportingCurrency.trim().toUpperCase();

  if (normalizedSource === normalizedTarget) {
    return {
      reportingMinor: nativeMinor,
      rateDate: saleDate,
      rateProvider: "identity",
      fallbackType: "exact",
    };
  }

  const rateRecord = await getExchangeRateForDate(normalizedSource, normalizedTarget, saleDate);

  if (!rateRecord) {
    try {
      await refreshExchangeRate(normalizedSource, normalizedTarget);
    } catch {
      // Refresh failed; rate is genuinely missing.
    }
    const retry = await getExchangeRateForDate(normalizedSource, normalizedTarget, saleDate);
    if (!retry) {
      return {
        excluded: true,
        reason: `No ${normalizedSource}→${normalizedTarget} rate available for ${saleDate.toISOString().slice(0, 10)}`,
      };
    }
    const major = nativeToMajor(nativeMinor, normalizedSource);
    const targetScale = currencyScale(normalizedTarget);
    const converted = convertMoney(major, retry.rate, targetScale);
    return {
      reportingMinor: majorToNative(converted, normalizedTarget),
      rateDate: retry.rateDate,
      rateProvider: retry.provider,
      fallbackType: retry.selection,
    };
  }

  const major = nativeToMajor(nativeMinor, normalizedSource);
  const targetScale = currencyScale(normalizedTarget);
  const converted = convertMoney(major, rateRecord.rate, targetScale);
  return {
    reportingMinor: majorToNative(converted, normalizedTarget),
    rateDate: rateRecord.rateDate,
    rateProvider: rateRecord.provider,
    fallbackType: rateRecord.selection,
  };
}

export type NativeLineAmount = {
  nativeMinor: bigint;
  currency: string;
  saleDate: Date;
};

export async function aggregateConvertToReporting(
  lines: NativeLineAmount[],
  reportingCurrency: string,
): Promise<AggregatedConversion> {
  let reportingMinorTotal = 0n;
  let convertedCount = 0;
  let identityCount = 0;
  let excludedCount = 0;
  const excludedCurrencies: Record<string, { count: number; nativeMinorTotal: bigint }> = {};
  const fallbackTypeDistribution: Record<HistoricalRateSelection, number> = { exact: 0, prior: 0, future: 0 };

  for (const line of lines) {
    const result = await convertNativeToReporting(line.nativeMinor, line.currency, line.saleDate, reportingCurrency);
    if (result.excluded) {
      excludedCount++;
      const bucket = excludedCurrencies[line.currency] ?? { count: 0, nativeMinorTotal: 0n };
      bucket.count++;
      bucket.nativeMinorTotal += line.nativeMinor;
      excludedCurrencies[line.currency] = bucket;
    } else {
      convertedCount++;
      if (result.rateProvider === "identity") identityCount++;
      reportingMinorTotal += result.reportingMinor;
      fallbackTypeDistribution[result.fallbackType] = (fallbackTypeDistribution[result.fallbackType] ?? 0) + 1;
    }
  }

  return {
    reportingMinorTotal,
    coverage: {
      convertedCount,
      identityCount,
      excludedCount,
      excludedCurrencies,
      fallbackTypeDistribution,
    },
  };
}
