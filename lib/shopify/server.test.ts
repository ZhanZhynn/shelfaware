import { afterEach, describe, expect, it, vi } from "vitest";
import { validateShopifyToken } from "./server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateShopifyToken", () => {
  it("validates the domain and token from its explicit context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { shop: { name: "Selected shop" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateShopifyToken({
      shopDomain: "selected.myshopify.com",
      accessToken: "selected-token",
    })).resolves.toEqual({ valid: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://selected.myshopify.com/admin/api/2025-07/graphql.json",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Shopify-Access-Token": "selected-token" }),
      }),
    );
  });
});
