import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { defaultConfig } from "next/dist/server/config-shared";
import { ImageOptimizerCache, imageOptimizer } from "next/dist/server/image-optimizer";
import { getSharp } from "next/dist/server/image-optimizer/transform";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { buildImageOptimizationConfig } from "./image-optimization";

function validateSource(url: string, endpoint?: string, overrides: Record<string, string> = {}) {
  // This request validator only reads images, not Next's rendering-runtime fields.
  const config = {
    images: { ...imageConfigDefault, ...buildImageOptimizationConfig(endpoint) },
  } as Parameters<typeof ImageOptimizerCache.validateParams>[2];

  return ImageOptimizerCache.validateParams(
    { headers: {} } as IncomingMessage,
    { url, w: "64", q: "75", ...overrides },
    config,
    false,
  );
}

describe("image optimizer source authorization", () => {
  const endpoint = "https://ik.imagekit.io/owned_account";

  it.each([
    `${endpoint}/stock-inventory/products/product.png`,
    `${endpoint}/stock-inventory/qr-codes/code.png`,
  ])("permits an owned uploaded image: %s", (url) => {
    expect(validateSource(url, `${endpoint}/`)).not.toHaveProperty("errorMessage");
  });

  it.each([
    "https://ik.imagekit.io/unrelated-account/product.png",
    "https://ik.imagekit.io/owned_account-other/product.png",
    "https://ik.imagekit.io/owned_account/../unrelated-account/product.png",
    "http://ik.imagekit.io/owned_account/product.png",
    "https://ik.imagekit.io:8443/owned_account/product.png",
    "https://ik.imagekit.io.attacker.example/owned_account/product.png",
    "https://robohash.org/attacker.png",
    "https://lh3.googleusercontent.com/attacker.png",
    "https://127.0.0.1/owned_account/product.png",
    `${endpoint}/product.png?redirect=https://attacker.example/image.png`,
  ])("rejects unauthorized sources through Next's request validator: %s", (url) => {
    expect(validateSource(url, endpoint)).toHaveProperty("errorMessage", '"url" parameter is not allowed');
  });

  it("denies remote optimization when ImageKit is not configured", () => {
    expect(validateSource(`${endpoint}/product.png`)).toHaveProperty("errorMessage");
    expect(validateSource(`${endpoint}/product.png`, " ")).toHaveProperty("errorMessage");
  });

  it("scopes a configured custom delivery domain to its path", () => {
    const customEndpoint = "https://images.example.com/catalog";
    expect(validateSource(`${customEndpoint}/product.png`, customEndpoint)).not.toHaveProperty("errorMessage");
    expect(validateSource("https://images.example.com/other/product.png", customEndpoint)).toHaveProperty("errorMessage");
    expect(validateSource("https://other.example.com/catalog/product.png", customEndpoint)).toHaveProperty("errorMessage");
  });

  it("supports an owned custom delivery domain at its root", () => {
    expect(validateSource("https://images.example.com/product.png", "https://images.example.com")).not.toHaveProperty("errorMessage");
  });

  it("rejects arbitrary optimization qualities", () => {
    expect(validateSource(`${endpoint}/product.png`, endpoint, { q: "100" })).toHaveProperty("errorMessage");
  });

  it.each([
    "not a URL",
    "http://ik.imagekit.io/owned_account",
    "https://ik.imagekit.io",
    "https://ik.imagekit.io/",
    "https://ik.imagekit.io/owned_account/..",
    "https://ik.imagekit.io/**",
    "https://ik.imagekit.io/owned_account/*",
    "https://ik.imagekit.io/owned_account?key=value",
    "https://ik.imagekit.io/owned_account#fragment",
    "https://ik.imagekit.io:8443/owned_account",
    "https://user:synthetic-secret@ik.imagekit.io/owned_account",
    "https://*.example.com/catalog",
  ])("fails closed for unsafe configuration: %s", (endpoint) => {
    expect(() => buildImageOptimizationConfig(endpoint)).toThrow("ImageKit URL endpoint must be an HTTPS account URL");
  });

  it("does not echo credentials in configuration errors", () => {
    let failure: unknown;
    try {
      buildImageOptimizationConfig("https://user:synthetic-private-value@ik.imagekit.io/account");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("synthetic-private-value");
  });
});

describe("patched image processing", () => {
  const config = {
    experimental: defaultConfig.experimental,
    images: { ...imageConfigDefault, ...buildImageOptimizationConfig() },
  };
  const params = { href: "https://ik.imagekit.io/owned_account/code.png", width: 32, quality: 75 };

  it.each(["image/webp", "image/avif"])("optimizes a PNG through Next and Sharp to %s", async (mimeType) => {
    const dataUrl = await QRCode.toDataURL("synthetic-image-smoke-test", { width: 64 });
    const buffer = Buffer.from(dataUrl.split(",")[1]!, "base64");
    const result = await imageOptimizer(
      { buffer, contentType: "image/png", cacheControl: null, etag: "synthetic-image" },
      { ...params, mimeType },
      config,
      { isDev: false, silent: true },
    );

    expect(result.error).toBeUndefined();
    expect(result.contentType).toBe(mimeType);
    expect(await getSharp(undefined, undefined)(result.buffer).metadata()).toMatchObject({ width: 32, height: 32 });
  });

  it("rejects SVG source content before transformation", async () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    await expect(imageOptimizer(
      { buffer, contentType: "image/svg+xml", cacheControl: null, etag: "synthetic-svg" },
      { ...params, mimeType: "image/webp" },
      config,
      { isDev: false, silent: true },
    )).rejects.toMatchObject({ statusCode: 400 });
  });
});
