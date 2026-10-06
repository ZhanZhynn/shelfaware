import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), parseLiveQuery: vi.fn(), listMarketplaceLive: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({ requireApiActor: mocks.requireApiActor, ApiScopeError: class ApiScopeError extends Error {} }));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/v1/live", () => ({
  parseLiveQuery: mocks.parseLiveQuery,
  listMarketplaceLive: mocks.listMarketplaceLive,
  MarketplaceLiveValidationError: class MarketplaceLiveValidationError extends Error {},
  MarketplaceLiveNotFoundError: class MarketplaceLiveNotFoundError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.parseLiveQuery.mockReturnValue({ shopId: "a".repeat(24), limit: 10, status: "READY_TO_SHIP" });
  mocks.listMarketplaceLive.mockResolvedValue({ data: [{ shopId: "a".repeat(24), externalId: "order-1", status: "READY_TO_SHIP", totalAmount: 12 }], page: { limit: 10, nextCursor: null } });
});

describe("live marketplace orders", () => {
  it("requires marketplace:live and returns only the adapter's normalized envelope", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/marketplaces/shopee/live/orders?shopId=${"a".repeat(24)}&limit=10`), { params: Promise.resolve({ platform: "shopee" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:live"]);
    expect(mocks.listMarketplaceLive).toHaveBeenCalledWith("shopee", expect.objectContaining({ id: "user-1" }), "orders", expect.objectContaining({ shopId: "a".repeat(24) }));
    expect(body).toMatchObject({ data: [{ externalId: "order-1", status: "READY_TO_SHIP" }], meta: { platform: "shopee", source: "live" } });
    expect(JSON.stringify(body)).not.toMatch(/email|address|phone|buyer/i);
  });

  it("does not call an adapter after rate limiting", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await GET(new NextRequest(`http://localhost/api/v1/marketplaces/shopee/live/orders?shopId=${"a".repeat(24)}`), { params: Promise.resolve({ platform: "shopee" }) });
    expect(response.status).toBe(429);
    expect(mocks.listMarketplaceLive).not.toHaveBeenCalled();
  });
});
