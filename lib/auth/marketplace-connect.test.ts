import { expect, it } from "vitest";
import { safeMarketplaceConnectPath } from "./marketplace-connect";

it.each(["https://evil.example", "//evil.example", "/marketplace/connect/../admin", "/marketplace/connect/tiktok?redirect=https://evil.example", "/marketplace/connect/shopify?shop=evil.example", "/marketplace/connect/shopify?shop=a.myshopify.com&shop=b.myshopify.com", "/marketplace/connect/tiktok#fragment"])("does not turn the connection return path into an open redirect: %s", (value) => {
  expect(safeMarketplaceConnectPath(value)).toBeNull();
});
it("permits only local, bounded marketplace return paths", () => {
  expect(safeMarketplaceConnectPath("/marketplace/connect/tiktok")).toBe("/marketplace/connect/tiktok");
  expect(safeMarketplaceConnectPath("/marketplace/connect/shopify?shop=shop.myshopify.com")).toBe("/marketplace/connect/shopify?shop=shop.myshopify.com");
});
