import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiActor: vi.fn(), withRateLimit: vi.fn(), getMarketplaceProduct: vi.fn(), parseMarketplaceRecordId: vi.fn((id: string) => id) }));
vi.mock("@/lib/auth/require-api-scope", () => ({
  requireApiActor: mocks.requireApiActor,
  ApiScopeError: class ApiScopeError extends Error {},
}));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class ApiTokenAuthenticationError extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/marketplace/v1/local-catalog", () => ({
  getMarketplaceProduct: mocks.getMarketplaceProduct,
  parseMarketplaceRecordId: mocks.parseMarketplaceRecordId,
  MarketplaceV1ValidationError: class MarketplaceV1ValidationError extends Error {},
  MarketplaceV1NotFoundError: class MarketplaceV1NotFoundError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.getMarketplaceProduct.mockResolvedValue({ id: "a".repeat(24), variants: [{ id: "b".repeat(24), sku: "WIDGET-RED" }] });
});

describe("v1 marketplace product detail", () => {
  it("requires marketplace:read and returns normalized variants from local storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/lazada/products/aaaaaaaaaaaaaaaaaaaaaaaa"), { params: Promise.resolve({ platform: "lazada", id: "a".repeat(24) }) });

    expect(response.status).toBe(200);
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:read"]);
    expect(mocks.withRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), expect.anything(), "api-token:token-1");
    expect(mocks.getMarketplaceProduct).toHaveBeenCalledWith("lazada", { id: "user-1", role: "admin" }, "a".repeat(24));
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "2026-marketplace-v1", data: { variants: [{ sku: "WIDGET-RED" }] }, meta: { platform: "lazada", source: "local" } });
  });

  it("does not read the record when rate limited", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/lazada/products/aaaaaaaaaaaaaaaaaaaaaaaa"), { params: Promise.resolve({ platform: "lazada", id: "a".repeat(24) }) });

    expect(response.status).toBe(429);
    expect(mocks.getMarketplaceProduct).not.toHaveBeenCalled();
  });
});
