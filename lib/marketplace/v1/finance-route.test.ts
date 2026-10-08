import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(), withRateLimit: vi.fn(), parseMarketplaceFinanceQuery: vi.fn(), assertMarketplaceFinanceShop: vi.fn(), getMarketplaceFinanceResult: vi.fn(),
}));
vi.mock("@/lib/auth/require-api-scope", () => ({
  requireApiActor: mocks.requireApiActor,
  ApiScopeError: class ApiScopeError extends Error {},
}));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("./finance", () => ({
  parseMarketplaceFinanceQuery: mocks.parseMarketplaceFinanceQuery,
  assertMarketplaceFinanceShop: mocks.assertMarketplaceFinanceShop,
  getMarketplaceFinanceResult: mocks.getMarketplaceFinanceResult,
  MarketplaceFinanceNotFoundError: class MarketplaceFinanceNotFoundError extends Error {},
  MarketplaceFinanceValidationError: class MarketplaceFinanceValidationError extends Error {},
}));

import { financeMarketplaceGet } from "./finance-route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.parseMarketplaceFinanceQuery.mockReturnValue({ shopId: "a".repeat(24), limit: 25 });
  mocks.getMarketplaceFinanceResult.mockResolvedValue({ data: [{ id: "ledger-1" }], page: { limit: 25, nextCursor: null } });
});

describe("v1 marketplace finance route", () => {
  it("uses marketplace:finance and the normalized local financial-records envelope", async () => {
    const response = await financeMarketplaceGet("financial-records", new NextRequest(`http://localhost/api/v1/marketplaces/shopee/financial-records?shopId=${"a".repeat(24)}`), { params: Promise.resolve({ platform: "shopee" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:finance"]);
    expect(mocks.withRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), expect.anything(), "api-token:token-1");
    expect(mocks.assertMarketplaceFinanceShop).toHaveBeenCalledWith("shopee", expect.anything(), "a".repeat(24));
    expect(body).toMatchObject({ apiVersion: "2026-marketplace-v1", data: [{ id: "ledger-1" }], page: { limit: 25 }, meta: { platform: "shopee", source: "local" } });
  });

  it("does not query finance data when rate limited", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await financeMarketplaceGet("profit", new NextRequest("http://localhost/api/v1/marketplaces/shopee/profit"), { params: Promise.resolve({ platform: "shopee" }) });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    expect(mocks.getMarketplaceFinanceResult).not.toHaveBeenCalled();
  });
});
