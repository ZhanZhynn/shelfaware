import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardBrowserWrite, trustedRequestOrigin } from "./browser-request";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://app.example.test");
  vi.stubEnv("APP_TRUSTED_ORIGINS", "https://console.example.test");
  for (const platform of ["SHOPEE", "LAZADA", "TIKTOK", "SHOPIFY"]) vi.stubEnv(`${platform}_REDIRECT_URL`, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("browser write request boundary", () => {
  it.each([undefined, "null", "https://attacker.example", "https://app.example.test.attacker.example", "http://app.example.test", "https://app.example.test:8443", "https://app.example.test/path"])("denies an untrusted or absent Origin: %s", (origin) => {
    const headers = new Headers({ "content-type": "application/json", host: "app.example.test", "x-forwarded-host": "app.example.test", "sec-fetch-site": "same-origin" });
    if (origin) headers.set("origin", origin);
    expect(guardBrowserWrite({ headers }, true)?.status).toBe(403);
  });

  it("allows exact configured origins and normal JSON charsets", () => {
    const headers = new Headers({ origin: "https://console.example.test", "sec-fetch-site": "same-site", "content-type": "application/json; charset=utf-8" });
    expect(guardBrowserWrite({ headers }, true)).toBeNull();
  });

  it("rejects form-compatible bodies and cross-site metadata", () => {
    const headers = new Headers({ origin: "https://app.example.test", "content-type": "text/plain" });
    expect(guardBrowserWrite({ headers }, true)?.status).toBe(415);
    headers.set("content-type", "application/json"); headers.set("sec-fetch-site", "cross-site");
    expect(guardBrowserWrite({ headers }, true)?.status).toBe(403);
  });

  it("does not make login depend on an unused provider's invalid callback", () => {
    vi.stubEnv("SHOPIFY_REDIRECT_URL", "http://localhost:3000/api/shopify/callback");
    expect(trustedRequestOrigin({ headers: new Headers({ origin: "https://app.example.test" }) })).toBe("https://app.example.test");
  });

  it("recognizes an explicitly configured callback origin without trusting a request Host", () => {
    vi.stubEnv("TIKTOK_REDIRECT_URL", "https://callback.example.test/api/tiktok/callback");
    expect(trustedRequestOrigin({ headers: new Headers({ origin: "https://callback.example.test", host: "evil.example" }) })).toBe("https://callback.example.test");
  });

  it("trusts only the actual Vercel preview origin, not a caller-supplied preview hostname", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "branch-team.vercel.app");
    expect(trustedRequestOrigin({ headers: new Headers({ origin: "https://branch-team.vercel.app" }) })).toBe("https://branch-team.vercel.app");
    expect(trustedRequestOrigin({ headers: new Headers({ origin: "https://attacker.vercel.app", host: "branch-team.vercel.app" }) })).toBeNull();
  });
});
