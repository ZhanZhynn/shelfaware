import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ actor: vi.fn(), rate: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", async () => ({ ...await vi.importActual("@/lib/auth/require-api-scope"), requireApiActor: m.actor }));
vi.mock("@/lib/api/rate-limit", () => ({ defaultRateLimits: { standard: {} }, withRateLimit: m.rate }));
vi.mock("@/lib/marketplace/sla/report", () => ({ getSlaReport: m.report }));
vi.mock("./live", () => ({ classifyLiveProviderError: () => ({ code: "LIVE_PROVIDER_TEMPORARY", retryable: true, retryAfterSeconds: 30 }) }));
import { slaMarketplaceGet } from "./sla-route";
import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { SlaError } from "@/lib/marketplace/sla/domain";
const request = (extra = "") => new NextRequest(`http://localhost/api/v1/marketplaces/shopee/sla/summary?shopId=${"a".repeat(24)}&${extra}`, { headers: { "x-request-id": "sla-request" } });
beforeEach(() => { vi.resetAllMocks(); m.actor.mockResolvedValue({ authType: "api_token", tokenId: "token", user: { id: "actor", role: "admin" } }); m.rate.mockResolvedValue(null); m.report.mockResolvedValue({ data: { pendingOrders: 0 }, coverage: { state: "missing" } }); });

describe("SLA API authentication and error boundaries", () => {
  it.each(["shopee", "lazada", "tiktok"])("requires read scope and preserves missing coverage for %s", async (platform) => {
    const result = await slaMarketplaceGet(request(), platform, "summary");
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({ apiVersion: "2026-marketplace-sla-v1", requestId: "sla-request", coverage: { state: "missing" } });
    expect(m.actor).toHaveBeenCalledWith(expect.anything(), ["marketplace:read"]);
    expect(m.rate).toHaveBeenCalledWith(expect.anything(), expect.anything(), "api-token:token");
  });

  it("requires both read and live scopes before live provider queries", async () => {
    await slaMarketplaceGet(request("live=true"), "shopee", "orders");
    expect(m.actor).toHaveBeenCalledWith(expect.anything(), ["marketplace:read", "marketplace:live"]);
    m.actor.mockRejectedValueOnce(new ApiScopeError());
    const result = await slaMarketplaceGet(request("live=true"), "shopee", "orders");
    expect(result.status).toBe(403); expect(m.report).toHaveBeenCalledTimes(1);
  });

  it.each([[new ApiTokenAuthenticationError("private"), 401], [new ApiScopeError("private"), 403], [new Error("private"), 500]])("redacts authorization failures", async (error, status) => {
    m.actor.mockRejectedValueOnce(error);
    const result = await slaMarketplaceGet(request(), "shopee", "summary");
    expect(result.status).toBe(status); expect(JSON.stringify(await result.json())).not.toContain("private"); expect(m.report).not.toHaveBeenCalled();
  });

  it("rejects invalid queries and unsupported platforms before data access", async () => {
    expect((await slaMarketplaceGet(request("live=true&cursor=100"), "shopee", "orders")).status).toBe(422);
    expect((await slaMarketplaceGet(request(), "shopify", "orders")).status).toBe(404);
    expect(m.report).not.toHaveBeenCalled();
    m.rate.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await slaMarketplaceGet(request(), "shopee", "summary")).status).toBe(429);
  });

  it("maps missing ownership and provider failures without returning raw details", async () => {
    m.report.mockRejectedValueOnce(new SlaError("NOT_FOUND", "Shop not found", 404));
    expect((await slaMarketplaceGet(request(), "shopee", "summary")).status).toBe(404);
    m.report.mockRejectedValueOnce(new Error("PRIVATE_TOKEN"));
    const result = await slaMarketplaceGet(request("live=true"), "shopee", "summary");
    expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ error: { code: "LIVE_PROVIDER_TEMPORARY", details: { retryAfterSeconds: 30 } } });
  });
});
