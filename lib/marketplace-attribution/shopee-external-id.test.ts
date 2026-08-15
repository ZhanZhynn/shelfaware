import { describe, expect, it } from "vitest";
import { normalizeShopeeExternalId } from "./shopee-external-id";

describe("normalizeShopeeExternalId", () => {
  it("preserves valid large Shopee model IDs", () => {
    expect(normalizeShopeeExternalId("77642689395")).toBe("77642689395");
  });

  it("rejects non-decimal and unsafe identities", () => {
    expect(() => normalizeShopeeExternalId("model-1")).toThrow("decimal integers");
    expect(() => normalizeShopeeExternalId("9007199254740992")).toThrow("supported range");
  });
});
