import { beforeEach, describe, expect, it, vi } from "vitest";

const getExchangeRateForDate = vi.hoisted(() => vi.fn());
const refreshExchangeRate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/exchange-rates/service", () => ({
  getExchangeRateForDate,
  refreshExchangeRate,
}));

vi.mock("@/lib/money", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/money")>();
  return { ...actual };
});

import { aggregateConvertToReporting, convertNativeToReporting } from "./fx-conversion";

describe("convertNativeToReporting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns identity when source equals reporting currency", async () => {
    const result = await convertNativeToReporting(10000n, "MYR", new Date("2026-01-15"), "MYR");
    expect(result).toEqual({
      reportingMinor: 10000n,
      rateDate: new Date("2026-01-15"),
      rateProvider: "identity",
      fallbackType: "exact",
    });
    expect(getExchangeRateForDate).not.toHaveBeenCalled();
  });

  it("uses exact rate when available", async () => {
    getExchangeRateForDate.mockResolvedValueOnce({
      baseCurrency: "SGD",
      quoteCurrency: "MYR",
      rate: 3.5,
      provider: "frankfurter",
      rateDate: new Date("2026-01-15"),
      fetchedAt: new Date(),
      selection: "exact",
    });
    const result = await convertNativeToReporting(1000n, "SGD", new Date("2026-01-15"), "MYR");
    expect(result).toEqual(expect.objectContaining({
      reportingMinor: 3500n,
      fallbackType: "exact",
    }));
    expect(getExchangeRateForDate).toHaveBeenCalledWith("SGD", "MYR", expect.any(Date));
  });

  it("uses prior fallback rate", async () => {
    getExchangeRateForDate.mockResolvedValueOnce({
      baseCurrency: "SGD",
      quoteCurrency: "MYR",
      rate: 3.4,
      provider: "frankfurter",
      rateDate: new Date("2026-01-10"),
      fetchedAt: new Date(),
      selection: "prior",
    });
    const result = await convertNativeToReporting(1000n, "SGD", new Date("2026-01-15"), "MYR");
    expect(result).toEqual(expect.objectContaining({
      reportingMinor: 3400n,
      fallbackType: "prior",
      rateDate: new Date("2026-01-10"),
    }));
  });

  it("uses future fallback rate", async () => {
    getExchangeRateForDate.mockResolvedValueOnce({
      baseCurrency: "SGD",
      quoteCurrency: "MYR",
      rate: 3.6,
      provider: "frankfurter",
      rateDate: new Date("2026-01-20"),
      fetchedAt: new Date(),
      selection: "future",
    });
    const result = await convertNativeToReporting(1000n, "SGD", new Date("2026-01-15"), "MYR");
    expect(result).toEqual(expect.objectContaining({
      reportingMinor: 3600n,
      fallbackType: "future",
      rateDate: new Date("2026-01-20"),
    }));
  });

  it("excludes when no rate exists even after refresh attempt", async () => {
    getExchangeRateForDate.mockResolvedValue(null);
    refreshExchangeRate.mockRejectedValue(new Error("no rate"));
    const result = await convertNativeToReporting(1000n, "THB", new Date("2026-01-15"), "MYR");
    expect(result).toEqual({
      excluded: true,
      reason: expect.stringContaining("No THB→MYR rate"),
    });
    expect(refreshExchangeRate).toHaveBeenCalledWith("THB", "MYR");
  });

  it("retries after refresh when initial lookup returns null", async () => {
    getExchangeRateForDate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        baseCurrency: "USD",
        quoteCurrency: "MYR",
        rate: 4.2,
        provider: "frankfurter",
        rateDate: new Date("2026-01-15"),
        fetchedAt: new Date(),
        selection: "exact",
      });
    refreshExchangeRate.mockResolvedValueOnce({});
    const result = await convertNativeToReporting(5000n, "USD", new Date("2026-01-15"), "MYR");
    expect(result).toEqual(expect.objectContaining({
      reportingMinor: 21000n,
      fallbackType: "exact",
    }));
    expect(refreshExchangeRate).toHaveBeenCalledWith("USD", "MYR");
  });

  it("rate date matches sale date, not report date", async () => {
    const saleDate = new Date("2026-03-01");
    getExchangeRateForDate.mockResolvedValueOnce({
      baseCurrency: "SGD",
      quoteCurrency: "MYR",
      rate: 3.5,
      provider: "frankfurter",
      rateDate: new Date("2026-03-01"),
      fetchedAt: new Date(),
      selection: "exact",
    });
    const result = await convertNativeToReporting(1000n, "SGD", saleDate, "MYR");
    expect(getExchangeRateForDate).toHaveBeenCalledWith("SGD", "MYR", saleDate);
    expect(result).toEqual(expect.objectContaining({ rateDate: new Date("2026-03-01") }));
  });

  it("handles zero-decimal currencies (JPY)", async () => {
    getExchangeRateForDate.mockResolvedValueOnce({
      baseCurrency: "JPY",
      quoteCurrency: "MYR",
      rate: 0.03,
      provider: "frankfurter",
      rateDate: new Date("2026-01-15"),
      fetchedAt: new Date(),
      selection: "exact",
    });
    const result = await convertNativeToReporting(1000n, "JPY", new Date("2026-01-15"), "MYR");
    expect(result).toEqual(expect.objectContaining({
      reportingMinor: 3000n,
      fallbackType: "exact",
    }));
  });
});

describe("aggregateConvertToReporting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts mixed currencies and returns total + coverage", async () => {
    getExchangeRateForDate.mockImplementation(async (base: string) => {
      if (base === "SGD") return { rate: 3.5, provider: "frankfurter", rateDate: new Date("2026-01-15"), selection: "exact" };
      if (base === "USD") return { rate: 4.2, provider: "frankfurter", rateDate: new Date("2026-01-15"), selection: "prior" };
      return null;
    });

    const lines = [
      { nativeMinor: 1000n, currency: "SGD", saleDate: new Date("2026-01-15") },
      { nativeMinor: 2000n, currency: "USD", saleDate: new Date("2026-01-15") },
      { nativeMinor: 500n, currency: "THB", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");

    expect(result.reportingMinorTotal).toBe(3500n + 8400n);
    expect(result.coverage.convertedCount).toBe(2);
    expect(result.coverage.excludedCount).toBe(1);
    expect(result.coverage.excludedCurrencies).toEqual({
      THB: { count: 1, nativeMinorTotal: 500n },
    });
    expect(result.coverage.fallbackTypeDistribution).toEqual({ exact: 1, prior: 1, future: 0 });
  });

  it("returns zero total when all lines excluded", async () => {
    getExchangeRateForDate.mockResolvedValue(null);
    refreshExchangeRate.mockRejectedValue(new Error("no rate"));

    const lines = [
      { nativeMinor: 1000n, currency: "XYZ", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");
    expect(result.reportingMinorTotal).toBe(0n);
    expect(result.coverage.convertedCount).toBe(0);
    expect(result.coverage.excludedCount).toBe(1);
  });

  it("converted total equals sum of individually converted lines, never native sum", async () => {
    getExchangeRateForDate.mockImplementation(async (base: string) => {
      if (base === "SGD") return { rate: 3.0, provider: "frankfurter", rateDate: new Date("2026-01-15"), selection: "exact" };
      if (base === "USD") return { rate: 4.0, provider: "frankfurter", rateDate: new Date("2026-01-15"), selection: "exact" };
      return null;
    });

    const lines = [
      { nativeMinor: 1000n, currency: "SGD", saleDate: new Date("2026-01-15") },
      { nativeMinor: 1000n, currency: "USD", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");

    const individualSgd = 3000n;
    const individualUsd = 4000n;
    expect(result.reportingMinorTotal).toBe(individualSgd + individualUsd);
    expect(result.reportingMinorTotal).not.toBe(2000n);
  });

  it("no conversion when reportingCurrency matches all source currencies", async () => {
    const lines = [
      { nativeMinor: 1000n, currency: "MYR", saleDate: new Date("2026-01-15") },
      { nativeMinor: 2000n, currency: "MYR", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");
    expect(result.reportingMinorTotal).toBe(3000n);
    expect(result.coverage.convertedCount).toBe(2);
    expect(result.coverage.excludedCount).toBe(0);
    expect(getExchangeRateForDate).not.toHaveBeenCalled();
  });

  it("tracks multiple excluded currencies with correct amounts", async () => {
    getExchangeRateForDate.mockResolvedValue(null);
    refreshExchangeRate.mockRejectedValue(new Error("no rate"));

    const lines = [
      { nativeMinor: 1000n, currency: "THB", saleDate: new Date("2026-01-15") },
      { nativeMinor: 2000n, currency: "THB", saleDate: new Date("2026-01-15") },
      { nativeMinor: 500n, currency: "XYZ", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");
    expect(result.coverage.excludedCurrencies).toEqual({
      THB: { count: 2, nativeMinorTotal: 3000n },
      XYZ: { count: 1, nativeMinorTotal: 500n },
    });
  });

  it("fallback type distribution counts each type correctly", async () => {
    getExchangeRateForDate.mockImplementation(async () => ({
      rate: 3.5,
      provider: "frankfurter",
      rateDate: new Date("2026-01-15"),
      selection: "prior",
    }));

    const lines = [
      { nativeMinor: 1000n, currency: "SGD", saleDate: new Date("2026-01-15") },
      { nativeMinor: 2000n, currency: "SGD", saleDate: new Date("2026-01-15") },
    ];

    const result = await aggregateConvertToReporting(lines, "MYR");
    expect(result.coverage.fallbackTypeDistribution).toEqual({ exact: 0, prior: 2, future: 0 });
  });
});
