import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rate: vi.fn(), execute: vi.fn(), response: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", () => ({ requireApiActor: mocks.actor, ApiScopeError: class extends Error {} }));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.rate, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/sync-foreground", () => ({ executeMarketplaceSyncForeground: mocks.execute }));
vi.mock("@/lib/marketplace/sync-runs", () => ({ marketplaceSyncRunResponse: mocks.response, MarketplaceSyncRunNotFoundError: class extends Error {} }));

import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { MarketplaceSyncRunNotFoundError } from "@/lib/marketplace/sync-runs";
import { MarketplaceSyncExecutionConflictError } from "@/lib/marketplace/sync-execution";
import { POST } from "./route";

const id = "a".repeat(24);
const params = () => ({ params: Promise.resolve({ platform: "lazada", id }) });
const request = () => new NextRequest(`http://localhost:3000/api/v1/marketplaces/lazada/syncs/${id}/execute`, { method: "POST", headers: { "x-request-id": "trace-id" }, body: "{}" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ user: { id: "owner", role: "admin" }, authType: "api_token", tokenId: "token" });
  mocks.rate.mockResolvedValue(null);
  mocks.execute.mockResolvedValue({ run: { id }, outcome: "checkpointed", retryAfterSeconds: 0 });
  mocks.response.mockReturnValue({ id, executionMode: "foreground", status: "running" });
});

describe("foreground execution API", () => {
  it("uses normal marketplace:sync auth, binds the origin, and returns uncached progress", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("trace-id");
    expect(mocks.actor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:sync"]);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith("lazada", id, { id: "owner", role: "admin" }, "http://localhost:3000");
    expect(await response.json()).toMatchObject({ data: { id, executionMode: "foreground", status: "running" }, meta: { execution: "foreground", outcome: "checkpointed", retryAfterSeconds: 0 } });
  });

  it.each([
    { error: new ApiTokenAuthenticationError(), status: 401 },
    { error: new ApiScopeError(), status: 403 },
  ])("rejects auth failures with $status before executing", async ({ error, status }) => {
    mocks.actor.mockRejectedValue(error);
    expect((await POST(request(), params())).status).toBe(status);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([
    { error: new MarketplaceSyncRunNotFoundError(), status: 404, code: "NOT_FOUND" },
    { error: new MarketplaceSyncExecutionConflictError("Origin differs"), status: 409, code: "SYNC_EXECUTION_CONFLICT" },
    { error: new Error("private provider message"), status: 500, code: "INTERNAL_ERROR" },
  ])("returns safe $code errors", async ({ error, status, code }) => {
    mocks.execute.mockRejectedValue(error);
    const response = await POST(request(), params());
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ error: { code, requestId: "trace-id" } });
    expect(JSON.stringify(body)).not.toContain("private provider message");
  });

  it("rejects malformed IDs without auth or execution", async () => {
    expect((await POST(request(), { params: Promise.resolve({ platform: "lazada", id: "bad" }) })).status).toBe(404);
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("honors rate limiting before executing work", async () => {
    mocks.rate.mockResolvedValue(NextResponse.json({ error: "Rate limited" }, { status: 429 }));
    expect((await POST(request(), params())).status).toBe(429);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
