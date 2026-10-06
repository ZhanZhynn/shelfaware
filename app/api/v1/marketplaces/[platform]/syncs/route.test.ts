import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), assertMarketplaceSyncShop: vi.fn(), createMarketplaceSyncJob: vi.fn(), marketplaceSyncJobResponse: vi.fn(), enqueueMarketplaceSyncJob: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({
  requireApiActor: mocks.requireApiActor,
  ApiScopeError: class ApiScopeError extends Error {},
}));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/sync-jobs", () => ({
  assertMarketplaceSyncShop: mocks.assertMarketplaceSyncShop,
  createMarketplaceSyncJob: mocks.createMarketplaceSyncJob,
  marketplaceSyncJobResponse: mocks.marketplaceSyncJobResponse,
  marketplaceSyncTypes: ["products", "orders", "finance", "returns", "ads", "payouts", "all"],
  MarketplaceSyncJobNotFoundError: class MarketplaceSyncJobNotFoundError extends Error {},
}));
vi.mock("@/lib/marketplace/sync-enqueue", () => ({ enqueueMarketplaceSyncJob: mocks.enqueueMarketplaceSyncJob }));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "c".repeat(24), role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.createMarketplaceSyncJob.mockResolvedValue({ job: { id: "a".repeat(24) }, coalesced: false });
  mocks.marketplaceSyncJobResponse.mockReturnValue({ id: "a".repeat(24), status: "pending" });
  mocks.enqueueMarketplaceSyncJob.mockResolvedValue({ scheduled: false });
});

describe("v1 marketplace sync creation", () => {
  it("requires marketplace:sync, persists the idempotency key, and leaves execution pending without a queue", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "request_1" },
      body: JSON.stringify({ shopId: "b".repeat(24), syncType: "orders", input: { daysBack: 30 } }),
    }), { params: Promise.resolve({ platform: "shopee" }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:sync"]);
    expect(mocks.withRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), expect.anything(), "api-token:token-1");
    expect(mocks.assertMarketplaceSyncShop).toHaveBeenCalledWith("shopee", "b".repeat(24), expect.anything());
    expect(mocks.createMarketplaceSyncJob).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "request_1", syncType: "orders", input: { daysBack: 30 } }));
    expect(mocks.enqueueMarketplaceSyncJob).toHaveBeenCalledWith("a".repeat(24), { notBefore: undefined });
    expect(body.meta).toMatchObject({ execution: "pending", coalesced: false });
  });

  it("publishes durable work when a queue is configured without executing it inline", async () => {
    mocks.enqueueMarketplaceSyncJob.mockResolvedValue({ scheduled: true });
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shopId: "b".repeat(24), syncType: "orders" }),
    }), { params: Promise.resolve({ platform: "shopee" }) });

    expect((await response.json()).meta.execution).toBe("scheduled");
    expect(mocks.enqueueMarketplaceSyncJob).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed internal shop IDs before querying a shop", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shopId: "provider-shop-id", syncType: "orders" }),
    }), { params: Promise.resolve({ platform: "shopee" }) });

    expect(response.status).toBe(422);
    expect(mocks.assertMarketplaceSyncShop).not.toHaveBeenCalled();
  });

  it("does not query a shop when rate limited", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", { method: "POST", body: "{}" }), { params: Promise.resolve({ platform: "shopee" }) });
    expect(response.status).toBe(429);
    expect(mocks.assertMarketplaceSyncShop).not.toHaveBeenCalled();
  });
});
