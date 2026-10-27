import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShopeeAuthUrl } from "@/lib/shopee/auth";
import { getLazadaAuthUrl } from "@/lib/lazada/server";
import { getTikTokAuthUrl } from "@/lib/tiktok/server";
import { getShopifyAuthUrl } from "@/lib/shopify/server";

beforeEach(() => {
  vi.stubEnv("SHOPEE_PARTNER_ID", "12345"); vi.stubEnv("SHOPEE_PARTNER_KEY", "fixture-partner-key");
  vi.stubEnv("SHOPEE_REDIRECT_URL", "https://app.example.test/api/shopee/callback");
  vi.stubEnv("LAZADA_APP_KEY", "fixture-app-key"); vi.stubEnv("LAZADA_APP_SECRET", "fixture-app-secret");
  vi.stubEnv("TIKTOK_APP_KEY", "fixture-tiktok-key"); vi.stubEnv("TIKTOK_APP_SECRET", "fixture-tiktok-secret");
  vi.stubEnv("TIKTOK_SERVICE_ID", "fixture-service");
  vi.stubEnv("SHOPIFY_API_KEY", "fixture-shopify-key"); vi.stubEnv("SHOPIFY_REDIRECT_URL", "https://app.example.test/api/shopify/callback");
});
afterEach(() => vi.unstubAllEnvs());

describe("marketplace SDK authorization URLs", () => {
  it.each([
    ["Shopee", () => getShopeeAuthUrl("fixture-state"), "https://app.example.test/api/shopee/callback"],
    ["Lazada", () => getLazadaAuthUrl("https://app.example.test/api/lazada/callback", "fixture-state"), "https://app.example.test/api/lazada/callback"],
    ["TikTok", () => getTikTokAuthUrl("https://app.example.test/api/tiktok/callback", "fixture-state"), "https://app.example.test/api/tiktok/callback"],
    ["Shopify", () => getShopifyAuthUrl("store.myshopify.com", "fixture-state"), "https://app.example.test/api/shopify/callback"],
  ])("%s passes state and the fixed callback to the provider", (_name, makeUrl, callback) => {
    const url = new URL(makeUrl()!);
    expect(url.searchParams.get("state")).toBe("fixture-state");
    expect(url.searchParams.get("redirect_uri")).toBe(callback);
  });
});
