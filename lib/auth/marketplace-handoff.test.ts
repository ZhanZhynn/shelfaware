import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ oauth: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth/oauth", () => ({ isGoogleOAuthConfigured: () => true, getGoogleOAuthUrl: m.oauth, getGoogleClientId: () => "fixture", getGoogleClientSecret: () => "fixture" }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: m.limit, defaultRateLimits: { auth: {} } }));
import { GET as googleStart } from "@/app/api/auth/oauth/google/route";
import { GET as googleCallback } from "@/app/api/auth/oauth/google/callback/route";
import { proxy } from "@/proxy";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://primary.example.test");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://primary.example.test"); vi.stubEnv("TIKTOK_REDIRECT_URL", "https://callback.example.test/api/tiktok/callback");
  m.limit.mockResolvedValue(null); m.oauth.mockImplementation((redirectUri: string) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ redirect_uri: redirectUri })}`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("redirects an unauthenticated connection to login on the configured callback host behind a tunnel", () => {
  const response = proxy(new NextRequest("http://localhost:3000/marketplace/connect/tiktok"));
  const destination = new URL(response.headers.get("location")!);
  expect(destination.origin).toBe("https://callback.example.test");
  expect(destination.searchParams.get("redirect")).toBe("/marketplace/connect/tiktok");
});
it("binds the Google return URI and connection cookie to the callback host", async () => {
  const response = await googleStart(new NextRequest("http://localhost:3000/api/auth/oauth/google?callback=%2Fmarketplace%2Fconnect%2Ftiktok"));
  const google = new URL(response.headers.get("location")!);
  expect(google.searchParams.get("redirect_uri")).toBe("https://callback.example.test/api/auth/oauth/google/callback");
  expect(response.cookies.get("oauth_callback")?.value).toBe("/marketplace/connect/tiktok");
});
it("returns errors to the callback host rather than a spoofed Host header", async () => {
  const request = new NextRequest("http://localhost:3000/api/auth/oauth/google/callback?error=access_denied", { headers: { cookie: "oauth_callback=%2Fmarketplace%2Fconnect%2Ftiktok", host: "evil.example" } });
  const response = await googleCallback(request);
  expect(new URL(response.headers.get("location")!).origin).toBe("https://callback.example.test");
});
