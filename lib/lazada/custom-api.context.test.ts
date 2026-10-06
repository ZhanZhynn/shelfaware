import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnvVar: (name: string) => name === "LAZADA_APP_KEY" ? "app-key" : "app-secret",
}));

import { getProductsCustom } from "./custom-api";
import type { LazadaShopContext } from "./server";

const shop = (overrides: Partial<LazadaShopContext> = {}): LazadaShopContext => ({
  shopId: "internal-shop-a",
  userId: "user-a",
  sellerId: "seller-a",
  countryCode: "my",
  accessToken: "token-a",
  refreshToken: "refresh-a",
  tokenExpiry: null,
  refreshExpiry: null,
  ...overrides,
});

describe("Lazada custom API context", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ code: "0", data: { products: [] } }) }));
  });

  it("uses only the explicitly supplied shop token and regional endpoint", async () => {
    await Promise.all([
      getProductsCustom(shop()),
      getProductsCustom(shop({ shopId: "internal-shop-b", sellerId: "seller-b", countryCode: "sg", accessToken: "token-b" })),
    ]);

    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringContaining("https://api.lazada.com.my/rest/products/get"),
      expect.stringContaining("access_token=token-a"),
      expect.stringContaining("https://api.lazada.sg/rest/products/get"),
      expect.stringContaining("access_token=token-b"),
    ]));
  });

  it("has no implicit shop fallback", async () => {
    await expect((getProductsCustom as unknown as () => Promise<unknown>)()).rejects.toThrow();
  });
});
