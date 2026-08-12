import { describe, expect, it } from "vitest";
import { intervalsOverlap, normalizeCatalogCode, normalizeSku } from "./intervals";

describe("attribution intervals", () => {
  it("treats an open mapping as overlapping a later mapping", () => {
    expect(intervalsOverlap({ effectiveFrom: new Date("2026-01-01"), effectiveTo: null }, { effectiveFrom: new Date("2026-02-01"), effectiveTo: null })).toBe(true);
  });

  it("permits adjacent closed intervals", () => {
    expect(intervalsOverlap({ effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-01-31T23:59:59.999Z") }, { effectiveFrom: new Date("2026-02-01"), effectiveTo: null })).toBe(false);
  });

  it("normalizes SKU punctuation without treating it as confirmation", () => {
    expect(normalizeSku(" sku- 01/a ")).toBe("SKU01A");
  });
  it("uses the same normalized code globally for catalog records", () => expect(normalizeCatalogCode(" family-01 ")).toBe("FAMILY01"));
});
