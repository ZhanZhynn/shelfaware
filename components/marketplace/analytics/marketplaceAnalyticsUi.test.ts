import { describe, expect, it, vi } from "vitest";
import { datePresetFilters, defaultMarketplaceFilters, displayPercent, displayValue, fetchMarketplaceMetric, filtersFromSearchParams, financialReportingCurrency, marketplaceFilterQuery, marketplaceUrlQuery, pageResultRange, validateMarketplaceFilters, withDefaultMarketplaceShop } from "./marketplaceAnalyticsUi";

describe("marketplace analytics UI helpers", () => {
  it("uses only applied non-default filters in a stable request query", () => {
    expect(marketplaceFilterQuery({ ...defaultMarketplaceFilters, shopId: "internal-shop", dateFrom: "2026-01-01", currency: "MYR" }, true)).toBe("shopId=internal-shop&dateFrom=2026-01-01&currency=MYR&granularity=day");
  });
  it("uses the v1 stats root for the summary contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchMarketplaceMetric("shopee", "summary", defaultMarketplaceFilters);
    expect(fetchMock).toHaveBeenCalledWith("/api/shopee/stats?apiVersion=2026-analytics-v1", { signal: undefined });
    vi.unstubAllGlobals();
  });
  it("rejects inverted date ranges and invalid currencies before a request", () => {
    expect(validateMarketplaceFilters({ ...defaultMarketplaceFilters, dateFrom: "2026-02-01", dateTo: "2026-01-01" })).toMatch(/cannot be after/);
    expect(validateMarketplaceFilters({ ...defaultMarketplaceFilters, currency: "ringgit" })).toMatch(/three-letter/);
  });
  it("uses valid UTC date presets only for the draft filter", () => {
    const draft = datePresetFilters(defaultMarketplaceFilters, "7", new Date("2026-03-10T17:00:00.000Z"));
    expect(draft.dateFrom).toBe("2026-03-04");
    expect(draft.dateTo).toBe("2026-03-10");
    expect(datePresetFilters(draft, "all")).toMatchObject({ dateFrom: "", dateTo: "" });
    expect(validateMarketplaceFilters({ ...defaultMarketplaceFilters, dateFrom: "2026-02-30" })).toMatch(/valid calendar/);
  });
  it("defaults an unspecified selection to the first authorized shop while retaining explicit all-shops URLs", () => {
    expect(withDefaultMarketplaceShop(defaultMarketplaceFilters, [{ id: "b" }, { id: "a" }])).toMatchObject({ shopId: "b", allShops: false });
    const explicitAll = filtersFromSearchParams(new URLSearchParams("allShops=1"));
    expect(withDefaultMarketplaceShop(explicitAll, [{ id: "first" }]).allShops).toBe(true);
    expect(marketplaceUrlQuery(explicitAll)).toBe("allShops=1");
  });
  it("serializes v1 cursor pages and preserves unavailable values separately from zero", () => {
    expect(pageResultRange({ limit: 25, cursor: "b2Zmc2V0OjI1", nextCursor: null, total: 26 })).toBe("26-26 of 26");
    expect(displayValue(null)).toBe("Unavailable");
    expect(displayValue(0)).toBe("0");
    expect(displayPercent(null)).toBe("Unavailable");
    expect(displayPercent(0)).toBe("0%");
    expect(marketplaceFilterQuery({ ...defaultMarketplaceFilters, shopId: "shop" })).toBe("shopId=shop");
  });
  it("reads reporting currency only from the v1 financial coverage contract", () => {
    expect(financialReportingCurrency({ financialCoverage: { reportingCurrency: "MYR" } })).toBe("MYR");
    expect(financialReportingCurrency({ financialCoverage: { reportingCurrency: "unknown" } })).toBeUndefined();
  });
});
