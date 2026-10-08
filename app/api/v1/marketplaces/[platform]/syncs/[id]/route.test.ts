import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), getMarketplaceSyncJob: vi.fn(), marketplaceSyncJobResponse: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({
  requireApiActor: mocks.requireApiActor,
  ApiScopeError: class ApiScopeError extends Error {},
}));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/sync-jobs", () => ({
  getMarketplaceSyncJob: mocks.getMarketplaceSyncJob,
  marketplaceSyncJobResponse: mocks.marketplaceSyncJobResponse,
  MarketplaceSyncJobNotFoundError: class MarketplaceSyncJobNotFoundError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "c".repeat(24), role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.getMarketplaceSyncJob.mockResolvedValue({ id: "a".repeat(24) });
  mocks.marketplaceSyncJobResponse.mockReturnValue({ id: "a".repeat(24), status: "pending" });
});

describe("v1 marketplace sync status", () => {
  it("requires marketplace:read and returns an uncached scoped status", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/marketplaces/shopee/syncs/${"a".repeat(24)}`), { params: Promise.resolve({ platform: "shopee", id: "a".repeat(24) }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:read"]);
    expect(mocks.getMarketplaceSyncJob).toHaveBeenCalledWith("shopee", "a".repeat(24), expect.anything());
    expect(body.data).toMatchObject({ id: "a".repeat(24) });
  });

  it("does not authenticate or query malformed job IDs", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs/not-an-object-id"), { params: Promise.resolve({ platform: "shopee", id: "not-an-object-id" }) });
    expect(response.status).toBe(404);
    expect(mocks.requireApiActor).not.toHaveBeenCalled();
    expect(mocks.getMarketplaceSyncJob).not.toHaveBeenCalled();
  });

  it("does not query a job when rate limited", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await GET(new NextRequest(`http://localhost/api/v1/marketplaces/shopee/syncs/${"a".repeat(24)}`), { params: Promise.resolve({ platform: "shopee", id: "a".repeat(24) }) });
    expect(response.status).toBe(429);
    expect(mocks.getMarketplaceSyncJob).not.toHaveBeenCalled();
  });
});
