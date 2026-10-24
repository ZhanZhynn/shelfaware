import { describe, expect, it } from "vitest";
import { adsWindows, calendarDate, civilDate, cpcWindow, decimalSum, derivedAdsMetrics, normalizeAdsMetrics, providerDate, providerSections, safeAdsError, shopContext, sumAdsMetrics } from "./ads-metrics";

describe("Shopee advertising metric evidence", () => {
  it("keeps conversion counts separate from rates and recomputes broken GMS CPA fields", () => {
    const metrics = normalizeAdsMetrics({ impression: 12090, clicks: 411, broad_order: 16, direct_order: 10, broad_conversions: 0.04, direct_conversions: 0.02, broad_order_amount: 35, direct_order_amount: 19, broad_gmv: 768.78, expense: 86.4, cpc: 540000, cpdc: 864000, direct_roi: 5.56 });
    expect(metrics).toMatchObject({ conversions: 16, directConversions: 10, itemsSold: 35, directItemsSold: 19, directGmv: null });
    expect(derivedAdsMetrics(metrics)).toMatchObject({ costPerConversion: 5.4, costPerDirectConversion: 8.64, directRoas: null });
  });

  it("sums decimal source amounts exactly and calculates ratios from totals", () => {
    expect(decimalSum([0.1, 0.2])).toBe(0.3);
    expect(decimalSum([1e-7, 2e-7])).toBe(3e-7);
    const first = normalizeAdsMetrics({ impression: 100, clicks: 10, broad_order: 2, expense: 1.1, broad_gmv: 5 });
    const second = normalizeAdsMetrics({ impression: 900, clicks: 10, broad_order: 1, expense: 2.2, broad_gmv: 10 });
    expect(derivedAdsMetrics(sumAdsMetrics([first, second]))).toMatchObject({ expense: 3.3, conversions: 3, ctr: 2, conversionRate: 15, costPerConversion: 1.1 });
    expect(decimalSum([Number.MAX_SAFE_INTEGER, 1])).toBeNull();
  });

  it("does not turn absent or malformed values into zero", () => {
    expect(normalizeAdsMetrics({ broad_order: "not a count", clicks: -1, direct_order: 0 })).toMatchObject({ conversions: null, clicks: null, directConversions: 0, expense: null });
    expect(sumAdsMetrics([]).expense).toBeNull();
    expect(derivedAdsMetrics(normalizeAdsMetrics({ clicks: 0, expense: 0 })).costPerClick).toBeNull();
    expect(normalizeAdsMetrics({ impression: Number.MAX_SAFE_INTEGER + 1 }).impressions).toBeNull();
  });

  it("preserves civil-date windows without overlaps or missing one-day tails", () => {
    const windows = adsWindows(calendarDate("2026-08-01"), calendarDate("2026-08-29"));
    expect(windows.map((range) => [range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)])).toEqual([["2026-08-01", "2026-08-28"], ["2026-08-29", "2026-08-29"]]);
    expect(cpcWindow(calendarDate("2026-08-29"), calendarDate("2026-08-29"), calendarDate("2026-10-24")).to).toEqual(calendarDate("2026-08-30"));
    expect(cpcWindow(calendarDate("2026-10-24"), calendarDate("2026-10-24"), calendarDate("2026-10-24")).from).toEqual(calendarDate("2026-10-23"));
    expect(civilDate(new Date("2026-08-31T16:00:00Z"), "Asia/Kuala_Lumpur")).toEqual(calendarDate("2026-09-01"));
    expect(providerDate("01-09-2026")).toEqual(calendarDate("2026-09-01"));
    expect(() => calendarDate("2026-02-30")).toThrow();
    expect(() => providerDate("2026-09-01")).toThrow();
  });

  it("accepts documented and live response envelopes and emits safe error codes", () => {
    expect(providerSections({ shop_id: 1 })).toEqual([{ shop_id: 1 }]);
    expect(providerSections([{ shop_id: 1 }])).toEqual([{ shop_id: 1 }]);
    expect(() => providerSections(null)).toThrow();
    expect(safeAdsError(new Error("API Error: ads.rate_limit.exceed_api token=private"))).toBe("ads.rate_limit.exceed_api");
    expect(safeAdsError(new Error("token=private"))).toBe("ADS_PROVIDER_REQUEST_FAILED");
    const storageError = new Error("private connection information"); storageError.name = "MongoServerError";
    expect(safeAdsError(storageError)).toBe("ADS_STORAGE_FAILED");
    expect(shopContext("MY")).toMatchObject({ timezone: "Asia/Kuala_Lumpur", currency: "MYR", currencySource: "shop_region" });
    expect(shopContext(null).currency).toBeNull();
  });
});
