import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ actor: vi.fn(), rate: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", async () => ({ ...await vi.importActual("@/lib/auth/require-api-scope"), requireApiActor: m.actor }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: m.rate, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/shopee/ads-report", async () => ({ ...await vi.importActual("@/lib/shopee/ads-report"), getShopeeAdsReport: m.report }));
import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { AdsReportError } from "@/lib/shopee/ads-report";
import { adsMarketplaceGet } from "./ads-route";

const request = () => new NextRequest("http://localhost/api/v1/marketplaces/shopee/ads/summary?shopId=shop", { headers: { "x-request-id": "ads-request" } });
const params = Promise.resolve({ platform: "shopee", view: "summary" });
beforeEach(() => {
  vi.clearAllMocks(); m.actor.mockResolvedValue({ authType: "api_token", tokenId: "token-id", user: { id: "actor" } }); m.rate.mockResolvedValue(null); m.report.mockResolvedValue({ data: { gmv: 12 }, coverage: { state: "observed" } });
});
describe("ads API auth and contract", () => {
  it("requires read scope and emits versioned, uncached correlated output", async () => {
    const response = await adsMarketplaceGet(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ apiVersion: "2026-shopee-ads-v1", requestId: "ads-request", data: { gmv: 12 } });
    expect(m.actor).toHaveBeenCalledWith(expect.anything(), ["marketplace:read"]);
    expect(m.rate).toHaveBeenCalledWith(expect.anything(), expect.anything(), "api-token:token-id");
  });
  it.each([[new ApiScopeError(), 403], [new ApiTokenAuthenticationError(), 401], [new Error("private"), 500]])("redacts auth failures", async (error, status) => {
    m.actor.mockRejectedValue(error); const response = await adsMarketplaceGet(request(), params); expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("private"); expect(m.report).not.toHaveBeenCalled();
  });
  it("handles unsupported platforms, rate limits, and validation errors", async () => {
    expect((await adsMarketplaceGet(request(), Promise.resolve({ platform: "lazada", view: "summary" }))).status).toBe(404);
    m.rate.mockResolvedValueOnce(NextResponse.json({}, { status: 429 })); expect((await adsMarketplaceGet(request(), params)).status).toBe(429);
    m.report.mockRejectedValueOnce(new AdsReportError("INVALID_DATE_RANGE", "Invalid dates")); expect((await adsMarketplaceGet(request(), params)).status).toBe(422);
    m.report.mockRejectedValueOnce(new Error("private")); const response = await adsMarketplaceGet(request(), params); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
