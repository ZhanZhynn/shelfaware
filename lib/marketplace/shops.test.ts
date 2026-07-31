import { describe, expect, it } from "vitest";
import { marketplaceShopOption, normalizePlatformShopId, observedSingleCurrencies } from "./shops";

describe("platform shop normalization", () => {
  it("canonicalizes platform external IDs without permitting invalid Shopee numeric IDs", () => {
    expect(normalizePlatformShopId("shopee", "00042")).toBe("42");
    expect(normalizePlatformShopId("shopify", " Store.MyShopify.Com ")).toBe("store.myshopify.com");
    expect(() => normalizePlatformShopId("shopee", "4.2")).toThrow("Invalid Shopee shop ID");
  });
  it("exposes an observed currency only when a shop has one stored source currency", () => {
    const currencies = observedSingleCurrencies([{ shopId: "one", currency: "MYR" }, { shopId: "one", currency: "MYR" }, { shopId: "many", currency: "MYR" }, { shopId: "many", currency: "SGD" }, { shopId: "missing", currency: null }]);
    expect(currencies.get("one")).toBe("MYR");
    expect(currencies.get("many")).toBeNull();
    expect(currencies.get("missing")).toBeUndefined();
  });
  it("does not expose an external marketplace identifier in selector metadata", () => {
    const option = marketplaceShopOption({ id: "internal", platform: "shopify", displayName: "Store", externalId: "store.myshopify.com", region: null, currency: "MYR", connectionState: "synced", lastSyncedAt: "2026-01-01T00:00:00.000Z" });
    expect(option).toMatchObject({ id: "internal", currency: "MYR", connectionState: "synced" });
    expect(option).not.toHaveProperty("externalId");
  });
});
