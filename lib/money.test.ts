import { describe, expect, it } from "vitest";
import { convertMoney, formatMoney, roundMoney } from "./money";

describe("money", () => {
  it("formats MYR and CNY with explicit currencies", () => {
    expect(formatMoney(12.5, "MYR")).toContain("RM");
    expect(formatMoney(12.5, "CNY")).not.toContain("RM");
  });

  it("converts and rounds only at the target currency boundary", () => {
    expect(convertMoney(12.5, 0.602882)).toBe(7.54);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("rejects invalid rates", () => {
    expect(() => convertMoney(1, 0)).toThrow("positive exchange rate");
  });
});
