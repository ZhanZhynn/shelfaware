import { describe, expect, it } from "vitest";
import { needsLegacyQualityMark } from "./mark-legacy-quality";

describe("legacy quality marking", () => {
  it("only marks unobserved records before the explicit cutoff and is idempotent", () => {
    const cutoff = new Date("2026-01-01");
    expect(needsLegacyQualityMark({ createdAt: new Date("2025-12-31"), sourceObservedAt: null, qualityMarkedAt: null }, cutoff)).toBe(true);
    expect(needsLegacyQualityMark({ createdAt: new Date("2026-01-02"), sourceObservedAt: null, qualityMarkedAt: null }, cutoff)).toBe(false);
    expect(needsLegacyQualityMark({ createdAt: new Date("2025-12-31"), sourceObservedAt: new Date(), qualityMarkedAt: null }, cutoff)).toBe(false);
    expect(needsLegacyQualityMark({ createdAt: new Date("2025-12-31"), sourceObservedAt: null, qualityMarkedAt: new Date() }, cutoff)).toBe(false);
  });
});
