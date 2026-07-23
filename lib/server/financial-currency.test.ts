import { describe, expect, it } from "vitest";
import { createFinancialCurrencyConverter, hasUnknownCurrency } from "./financial-currency";

describe("financial currency policy", () => {
  it("converts known amounts and excludes currencies without a persisted rate", () => {
    const currency = createFinancialCurrencyConverter("MYR", [{ baseCurrency: "CNY", rate: 0.61 }]);

    expect(currency.convert(100, "CNY")).toBe(61);
    expect(currency.convert(100, "USD")).toBeNull();
    expect(currency.convert(100, null)).toBeNull();
    expect(currency.convert(100, null, true)).toBe(100);
    expect(currency.metadata()).toMatchObject({
      baseCurrency: "MYR",
      exchangeRates: { CNY: 0.61 },
      excludedCurrencies: ["UNKNOWN", "USD"],
    });
  });

  it("identifies only absent marketplace currencies as unknown", () => {
    expect(hasUnknownCurrency(null)).toBe(true);
    expect(hasUnknownCurrency("  ")).toBe(true);
    expect(hasUnknownCurrency("MYR")).toBe(false);
  });
});
