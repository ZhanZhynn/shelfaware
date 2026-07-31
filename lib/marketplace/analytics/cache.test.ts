import { describe, expect, it } from "vitest";
import { marketplaceAnalyticsCacheKey } from "./cache";

describe("marketplace analytics cache key", () => {
  const input = { platform: "shopee" as const, accessScope: "admin-shared", shopIds: ["b", "a"], metric: "summary", dateFrom: "2026-01-01", dateTo: "2026-01-31", currency: "MYR", granularity: "day", cursor: "b2Zmc2V0OjI1", limit: 25 };
  it("is deterministic for a shop set and isolates scope and request dimensions", () => {
    expect(marketplaceAnalyticsCacheKey(input)).toBe(marketplaceAnalyticsCacheKey({ ...input, shopIds: ["a", "b", "a"] }));
    expect(marketplaceAnalyticsCacheKey(input)).not.toBe(marketplaceAnalyticsCacheKey({ ...input, accessScope: "user:x" }));
    expect(marketplaceAnalyticsCacheKey(input)).not.toBe(marketplaceAnalyticsCacheKey({ ...input, currency: "SGD" }));
  });
  it("isolates pagination limits even when the cursor is identical", () => {
    expect(marketplaceAnalyticsCacheKey(input)).not.toBe(marketplaceAnalyticsCacheKey({ ...input, limit: 50 }));
  });
});
