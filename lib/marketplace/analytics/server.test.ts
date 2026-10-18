import { describe, expect, it } from "vitest";
import { AnalyticsValidationError, buildAnalyticsFreshness, buildOperationalCoverage, isFinancialAnalyticsEligible, isFinancialAnalyticsReady, paginateAnalyticsValues, parseAnalyticsDateRange, parseAnalyticsPagination, resolveReportingCurrency, validateReportingCurrency } from "./server";
import { requestsMarketplaceAnalyticsV1, staticStatsContract } from "./http";

describe("analytics request validation", () => {
  it("rejects invalid and inverted dates", () => {
    expect(() => parseAnalyticsDateRange(new URLSearchParams("dateFrom=not-a-date"))).toThrow(AnalyticsValidationError);
    expect(() => parseAnalyticsDateRange(new URLSearchParams("dateFrom=2026-02-02&dateTo=2026-02-01"))).toThrow("dateFrom must not be after dateTo");
  });

  it("keeps a same-day calendar range inclusive and independent of server timezone", () => {
    const range = parseAnalyticsDateRange(new URLSearchParams({ dateFrom: "2026-10-18", dateTo: "2026-10-18" }));
    expect(range?.gte?.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(range?.lte?.toISOString()).toBe("2026-10-18T23:59:59.999Z");
  });

  it("accepts explicit local-day timestamp boundaries without expanding their upper bound", () => {
    const range = parseAnalyticsDateRange(new URLSearchParams({ dateFrom: "2026-10-18T00:00:00+08:00", dateTo: "2026-10-18T23:59:59.999+08:00" }));
    expect(range?.gte?.toISOString()).toBe("2026-10-17T16:00:00.000Z");
    expect(range?.lte?.toISOString()).toBe("2026-10-18T15:59:59.999Z");
    expect(parseAnalyticsDateRange(new URLSearchParams({ dateTo: "2026-10-18T12:00:00Z" }))?.lte?.toISOString()).toBe("2026-10-18T12:00:00.000Z");
  });

  it("rejects offset-free, invalid, and inverted timestamp boundaries", () => {
    for (const dateFrom of ["2026-10-18T00:00:00", "2026-02-30T00:00:00+08:00", "2026-10-18T25:00:00Z", "2026-10-18T00:00:00+25:00"]) {
      expect(() => parseAnalyticsDateRange(new URLSearchParams({ dateFrom }))).toThrow(AnalyticsValidationError);
    }
    expect(() => parseAnalyticsDateRange(new URLSearchParams({ dateFrom: "2026-10-18T00:00:00Z", dateTo: "2026-10-18T00:00:00+08:00" }))).toThrow("dateFrom must not be after dateTo");
  });

  it("does not permit mixed currencies or invented conversions", () => {
    expect(() => resolveReportingCurrency([{ currency: "MYR" }, { currency: "SGD" }], "native")).toThrow("Cannot aggregate");
    expect(() => resolveReportingCurrency([{ currency: "MYR" }], "USD")).toThrow("conversion");
    expect(resolveReportingCurrency([{ currency: "MYR" }], "native")).toBe("MYR");
  });

  it("accepts only v1 trend granularities", () => {
    expect(() => parseAnalyticsDateRange(new URLSearchParams("dateFrom=2026-02-30"))).toThrow(AnalyticsValidationError);
  });
  it("validates pagination and the currency allowlist before querying empty data", () => {
    expect(() => parseAnalyticsPagination(new URLSearchParams("limit=101"))).toThrow(AnalyticsValidationError);
    expect(() => parseAnalyticsPagination(new URLSearchParams("cursor=bad!"))).toThrow(AnalyticsValidationError);
    expect(() => validateReportingCurrency("ZZZ")).toThrow(AnalyticsValidationError);
    expect(validateReportingCurrency("MYR")).toBe("MYR");
  });
  it("requires both persisted finance capability and reconciliation readiness", () => {
    expect(isFinancialAnalyticsReady("available", false)).toBe(false);
    expect(isFinancialAnalyticsReady("unknown", true)).toBe(false);
    expect(isFinancialAnalyticsReady("available", true)).toBe(true);
  });
  it("denies finance without an exact server rollout for every selected shop", () => {
    expect(isFinancialAnalyticsEligible({ platform: "shopee", shops: [], finance: "available", readinessAndEvidenceApproved: true })).toBe(false);
    expect(isFinancialAnalyticsEligible({ platform: "shopee", shops: [{ id: "shop-a", region: "MY" }, { id: "shop-b", region: "MY" }], finance: "available", readinessAndEvidenceApproved: true })).toBe(false);
    expect(isFinancialAnalyticsEligible({ platform: "shopee", shops: [{ id: "shop-a", region: "MY" }], finance: "available", readinessAndEvidenceApproved: false })).toBe(false);
  });
  it("keeps root and metric static stats on the legacy contract unless a client opts into v1", () => {
    expect(requestsMarketplaceAnalyticsV1(new URLSearchParams("sellerId=legacy-seller"))).toBe(false);
    expect(requestsMarketplaceAnalyticsV1(new URLSearchParams("apiVersion=2026-analytics-v1&sellerId=legacy-seller"))).toBe(true);
    expect(staticStatsContract(new URLSearchParams("shopId=external-shop"))).toBe("legacy");
    expect(staticStatsContract(new URLSearchParams("sellerId=legacy-seller"))).toBe("legacy");
    expect(staticStatsContract(new URLSearchParams("apiVersion=2026-analytics-v1&shopId=internal-shop"))).toBe("v1");
  });
  it("returns distinct slices for an identical cursor with different limits", () => {
    const cursor = Buffer.from("offset:10").toString("base64url");
    const values = Array.from({ length: 50 }, (_, index) => index);
    const small = paginateAnalyticsValues(values, parseAnalyticsPagination(new URLSearchParams(`cursor=${cursor}&limit=5`)));
    const large = paginateAnalyticsValues(values, parseAnalyticsPagination(new URLSearchParams(`cursor=${cursor}&limit=20`)));
    expect(small.values).toEqual([10, 11, 12, 13, 14]);
    expect(large.values).toHaveLength(20);
  });
  it("reports observed operational unknowns without finance coverage", () => {
    const coverage = buildOperationalCoverage([{ createdAt: new Date("2026-01-02"), currency: "MYR", status: "", buyerId: null, items: [{ quantity: null }] }] as never, "available");
    expect(coverage).toMatchObject({ state: "partial", rawOrderCount: 1, unknownStatusCount: 1, unknownQuantityCount: 1, unknownIdentityCount: 1, sourceCurrencies: ["MYR"] });
    expect(coverage).not.toHaveProperty("financialCoveragePercent");
  });

  it("does not equate empty local history with zero provider orders", () => {
    const coverage = buildOperationalCoverage([], "unknown");
    expect(coverage).toMatchObject({ state: "unavailable", availability: "no_data", rawOrderCount: 0 });
    expect(coverage.reason).toContain("does not establish zero live orders");
  });

  it("reports observation and shop sync times without claiming complete history", () => {
    const computedAt = new Date("2026-10-18T13:00:00Z");
    const freshness = buildAnalyticsFreshness(
      [{ id: "shop-a", lastSyncedAt: "2026-10-18T12:00:00.000Z" }, { id: "shop-b", lastSyncedAt: null }],
      [null, new Date("2026-10-18T11:00:00Z"), new Date("2026-10-18T12:30:00Z")],
      computedAt,
    );
    expect(freshness).toEqual({
      source: "local", computedAt: computedAt.toISOString(), historyCompleteness: "unknown",
      latestMatchingOrderObservedAt: "2026-10-18T12:30:00.000Z",
      shops: [{ shopId: "shop-a", lastShopSyncAt: "2026-10-18T12:00:00.000Z" }, { shopId: "shop-b", lastShopSyncAt: null }],
    });
    expect(buildAnalyticsFreshness([], [null], computedAt).latestMatchingOrderObservedAt).toBeNull();
  });
});
