import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trustedClientIdentifier } from "./client-ip";

beforeEach(() => { vi.stubEnv("TRUSTED_PROXY_PROVIDER", undefined); vi.stubEnv("VERCEL", undefined); });
afterEach(() => vi.unstubAllEnvs());

it("does not let arbitrary client headers choose a limiter identity", () => {
  for (let i = 1; i < 30; i++) expect(trustedClientIdentifier(new Headers({ "x-user-id": `user-${i}`, "x-real-ip": `192.0.2.${i}`, "x-forwarded-for": `192.0.2.${i}`, "cf-connecting-ip": `192.0.2.${i}` }))).toBe("ip:unverified");
});
it("uses the configured Cloudflare ingress contract only", () => {
  vi.stubEnv("TRUSTED_PROXY_PROVIDER", "cloudflare");
  expect(trustedClientIdentifier(new Headers({ "cf-connecting-ip": "192.0.2.1", "x-real-ip": "192.0.2.2" }))).toBe("ip:192.0.2.1");
  expect(trustedClientIdentifier(new Headers({ "cf-connecting-ip": "192.0.2.1, 192.0.2.2" }))).toBe("ip:unverified");
});
it("uses Vercel's overwritten header only in a Vercel runtime", () => {
  vi.stubEnv("TRUSTED_PROXY_PROVIDER", "vercel");
  const headers = new Headers({ "x-forwarded-for": "2001:db8::1", "x-real-ip": "192.0.2.2" });
  expect(trustedClientIdentifier(headers)).toBe("ip:unverified");
  vi.stubEnv("VERCEL", "1");
  expect(trustedClientIdentifier(headers)).toBe("ip:2001:db8::1");
});
