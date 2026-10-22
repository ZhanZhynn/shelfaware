import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const m = vi.hoisted(() => ({ actor: vi.fn(), rateLimit: vi.fn(), getOrder: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({ requireApiActor: m.actor, ApiScopeError: class extends Error {} }));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: m.rateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/v1/live", async (original) => ({ ...await original<typeof import("@/lib/marketplace/v1/live")>(), getMarketplaceLiveOrder: m.getOrder }));

import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { MarketplaceLiveNotFoundError, MarketplaceLiveProviderError } from "@/lib/marketplace/v1/live";
import { GET } from "./route";

const context = (platform = "shopee", id = "261022ORDER") => ({ params: Promise.resolve({ platform, id }) });
const request = (query = `shopId=${"a".repeat(24)}`) => new NextRequest(`http://localhost/api/v1/marketplaces/shopee/live/orders/261022ORDER?${query}`, { headers: { "x-request-id": "detail-trace" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue({ user: { id: "owner", role: "admin" }, authType: "api_token", tokenId: "token-id" });
  m.rateLimit.mockResolvedValue(null);
  m.getOrder.mockResolvedValue({ externalId: "261022ORDER", lineItems: [{ productExternalId: "123", unitPrice: 10, subtotal: 20 }] });
});

describe("live Shopee order detail route", () => {
  it("requires the live scope and returns item lines with uncached live provenance", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("detail-trace");
    expect(m.actor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:live"]);
    expect(m.getOrder).toHaveBeenCalledWith("shopee", { id: "owner", role: "admin" }, "a".repeat(24), "261022ORDER");
    expect(await response.json()).toMatchObject({ data: { lineItems: [{ subtotal: 20 }] }, meta: { source: "live", requestId: "detail-trace" } });
  });

  it.each([new ApiScopeError(), new ApiTokenAuthenticationError()])("does not fetch after an auth failure", async (error) => {
    m.actor.mockRejectedValue(error);
    const response = await GET(request(), context());
    expect([401, 403]).toContain(response.status);
    expect(m.getOrder).not.toHaveBeenCalled();
  });

  it("does not fetch after rate limiting or invalid parameters", async () => {
    m.rateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await GET(request(), context())).status).toBe(429);
    for (const query of ["", "shopId=wrong", `shopId=${"a".repeat(24)}&includeItems=true`]) expect((await GET(request(query), context())).status).toBe(422);
    expect((await GET(request(), context("invalid"))).status).toBe(404);
    expect((await GET(request(), context("shopee", "order,injection"))).status).toBe(422);
    expect(m.getOrder).not.toHaveBeenCalled();
  });

  it.each([
    { error: new MarketplaceLiveNotFoundError("Order not found"), status: 404, code: "NOT_FOUND" },
    { error: new MarketplaceLiveProviderError("LIVE_PROVIDER_UNSUPPORTED", false), status: 422, code: "LIVE_PROVIDER_UNSUPPORTED" },
    { error: new MarketplaceLiveProviderError("LIVE_PROVIDER_AUTH_REQUIRED", false), status: 403, code: "LIVE_PROVIDER_AUTH_REQUIRED" },
    { error: new MarketplaceLiveProviderError("LIVE_PROVIDER_TEMPORARY", true, 30), status: 502, code: "LIVE_PROVIDER_TEMPORARY" },
    { error: new Error("private provider message"), status: 502, code: "LIVE_PROVIDER_TEMPORARY" },
  ])("maps $code to HTTP $status with request correlation", async ({ error, status, code }) => {
    m.getOrder.mockRejectedValue(error);
    const response = await GET(request(), context());
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ error: { code, requestId: "detail-trace" } });
    expect(JSON.stringify(body)).not.toContain("private provider message");
  });
});
