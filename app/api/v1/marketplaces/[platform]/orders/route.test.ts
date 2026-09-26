import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), parseLocalQuery: vi.fn(), listMarketplaceOrders: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({
  requireApiActor: mocks.requireApiActor,
  ApiScopeError: class ApiScopeError extends Error {},
}));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/v1/local-catalog", () => ({
  parseLocalQuery: mocks.parseLocalQuery,
  listMarketplaceOrders: mocks.listMarketplaceOrders,
  MarketplaceV1ValidationError: class MarketplaceV1ValidationError extends Error {},
  MarketplaceV1NotFoundError: class MarketplaceV1NotFoundError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.parseLocalQuery.mockReturnValue({ limit: 50 });
  mocks.listMarketplaceOrders.mockResolvedValue({ data: [{ id: "order-1", externalId: "external-1", status: "READY_TO_SHIP" }], page: { limit: 50, nextCursor: null } });
});

describe("v1 marketplace orders", () => {
  it("uses marketplace:read and returns the normalized local envelope", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shopee/orders"), { params: Promise.resolve({ platform: "shopee" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:read"]);
    expect(mocks.withRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), expect.anything(), "api-token:token-1");
    expect(body).toMatchObject({ apiVersion: "2026-marketplace-v1", data: [{ id: "order-1", externalId: "external-1" }], meta: { platform: "shopee", source: "local" } });
  });

  it("returns the limiter response before querying orders", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shopee/orders"), { params: Promise.resolve({ platform: "shopee" }) });
    expect(response.status).toBe(429);
    expect(mocks.listMarketplaceOrders).not.toHaveBeenCalled();
  });
});
