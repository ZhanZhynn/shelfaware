import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), assertMarketplaceSyncShop: vi.fn(), createMarketplaceSyncJob: vi.fn(), marketplaceSyncJobResponse: vi.fn(), enqueueMarketplaceSyncJob: vi.fn(), createShopeeAllSyncRun: vi.fn(), createShopeeBoundedSyncRun: vi.fn(), deliverMarketplaceSyncTaskOutbox: vi.fn(), marketplaceSyncRunResponse: vi.fn() }));
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
vi.mock("@/lib/marketplace/sync-runs", () => ({
  createShopeeAllSyncRun: mocks.createShopeeAllSyncRun,
  createShopeeBoundedSyncRun: mocks.createShopeeBoundedSyncRun,
  deliverMarketplaceSyncTaskOutbox: mocks.deliverMarketplaceSyncTaskOutbox,
  marketplaceSyncRunResponse: mocks.marketplaceSyncRunResponse,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "c".repeat(24), role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.createMarketplaceSyncJob.mockResolvedValue({ job: { id: "a".repeat(24) }, coalesced: false });
  mocks.marketplaceSyncJobResponse.mockReturnValue({ id: "a".repeat(24), status: "pending" });
  mocks.enqueueMarketplaceSyncJob.mockResolvedValue({ scheduled: false });
  mocks.createShopeeAllSyncRun.mockResolvedValue({ run: { id: "d".repeat(24) }, coalesced: false, firstTaskId: "e".repeat(24) });
  mocks.createShopeeBoundedSyncRun.mockResolvedValue({ run: { id: "d".repeat(24) }, coalesced: false, firstTaskId: "e".repeat(24) });
  mocks.deliverMarketplaceSyncTaskOutbox.mockResolvedValue({ scheduled: false });
  mocks.marketplaceSyncRunResponse.mockReturnValue({ id: "d".repeat(24), status: "pending", tasks: [] });
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

  it("creates only Shopee all as a run with an initial durable task delivery", async () => {
    mocks.deliverMarketplaceSyncTaskOutbox.mockResolvedValue({ scheduled: true });
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shopId: "b".repeat(24), syncType: "all" }),
    }), { params: Promise.resolve({ platform: "shopee" }) });

    expect(response.status).toBe(202);
    expect(mocks.createShopeeAllSyncRun).toHaveBeenCalledWith(expect.objectContaining({ shopId: "b".repeat(24), requestedByUserId: "c".repeat(24) }));
    expect(mocks.deliverMarketplaceSyncTaskOutbox).toHaveBeenCalledWith("e".repeat(24));
    expect(mocks.createMarketplaceSyncJob).not.toHaveBeenCalled();
    expect((await response.json()).meta.execution).toBe("scheduled");
  });

  it("routes a valid Shopee historical orders request through a bounded task run", async () => {
    const input = { dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" };
    const response = await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shopId: "b".repeat(24), syncType: "orders", input }),
    }), { params: Promise.resolve({ platform: "shopee" }) });

    expect(response.status).toBe(202);
    expect(mocks.createShopeeBoundedSyncRun).toHaveBeenCalledWith(expect.objectContaining({ syncType: "orders", input }));
    expect(mocks.createMarketplaceSyncJob).not.toHaveBeenCalled();
    expect(mocks.deliverMarketplaceSyncTaskOutbox).toHaveBeenCalledWith("e".repeat(24));
  });

  it("keeps date-scoped Shopee all on its existing graph so products and ads retain their defaults", async () => {
    const input = { dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" };
    await POST(new NextRequest("http://localhost/api/v1/marketplaces/shopee/syncs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shopId: "b".repeat(24), syncType: "all", input }),
    }), { params: Promise.resolve({ platform: "shopee" }) });

    expect(mocks.createShopeeAllSyncRun).toHaveBeenCalledWith(expect.objectContaining({ input }));
  });

  it.each([
    [{ dateFrom: "2025-01-01T00:00:00Z" }, "shopee", "orders"],
    [{ dateFrom: "2025-01-02T00:00:00", dateTo: "2025-01-01T00:00:00Z" }, "shopee", "orders"],
    [{ dateFrom: "2025-02-30T00:00:00Z", dateTo: "2025-03-01T00:00:00Z" }, "shopee", "orders"],
    [{ dateFrom: "2024-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" }, "shopee", "orders"],
    [{ dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" }, "lazada", "orders"],
    [{ dateFrom: "2025-01-01T00:00:00Z", dateTo: "2025-01-02T00:00:00Z" }, "shopee", "ads"],
  ])("rejects unsupported or invalid date ranges", async (input, platform, syncType) => {
    const response = await POST(new NextRequest(`http://localhost/api/v1/marketplaces/${platform}/syncs`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shopId: "b".repeat(24), syncType, input }),
    }), { params: Promise.resolve({ platform }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_DATE_RANGE");
    expect(mocks.assertMarketplaceSyncShop).not.toHaveBeenCalled();
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
