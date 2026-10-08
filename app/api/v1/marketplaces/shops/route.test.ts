import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  withRateLimit: vi.fn(),
  accessibleMarketplaceShops: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/require-api-scope")>(),
  requireApiActor: mocks.requireApiActor,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  withRateLimit: mocks.withRateLimit,
  defaultRateLimits: { standard: { limit: 600, window: 60 } },
}));
vi.mock("@/lib/marketplace/shops", () => ({
  accessibleMarketplaceShops: mocks.accessibleMarketplaceShops,
  marketplaceShopOption: (shop: { externalId: string } & Record<string, unknown>) => {
    const { externalId: _externalId, ...publicShop } = shop;
    return publicShop;
  },
}));

import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.accessibleMarketplaceShops.mockResolvedValue([{ id: "shop-1", platform: "shopee", displayName: "Main", externalId: "123", region: "MY", currency: "MYR", connectionState: "synced", lastSyncedAt: null }]);
});

describe("v1 marketplace shops", () => {
  it("returns authorized shops without provider external IDs", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shops?platform=shopee"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:read"]);
    expect(mocks.withRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), expect.anything(), "api-token:token-1");
    expect(body.data[0]).not.toHaveProperty("externalId");
  });

  it("returns 401 for an invalid bearer token", async () => {
    mocks.requireApiActor.mockRejectedValue(new ApiTokenAuthenticationError("Invalid bearer token"));
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shops"));
    expect(response.status).toBe(401);
  });

  it("returns 403 for a token missing the required scope", async () => {
    mocks.requireApiActor.mockRejectedValue(new ApiScopeError("Token is missing a required scope"));
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shops"));
    expect(response.status).toBe(403);
  });

  it("returns the rate-limit response before querying shops", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await GET(new NextRequest("http://localhost/api/v1/marketplaces/shops"));
    expect(response.status).toBe(429);
    expect(mocks.accessibleMarketplaceShops).not.toHaveBeenCalled();
  });
});
