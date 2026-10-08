import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
  mocks.requireApiActor.mockResolvedValue({ user: { id: "user-1", role: "admin" }, authType: "session" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.parseLiveQuery.mockReturnValue({ shopId: "b".repeat(24), limit: 20, status: "ACTIVE" });
  mocks.listMarketplaceLive.mockResolvedValue({ data: [{ shopId: "b".repeat(24), externalId: "product-1", title: "Product", status: "ACTIVE" }], page: { limit: 20, nextCursor: "next" } });
});

describe("live marketplace products", () => {
  it("uses the live scope and the internal shop ID query", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/marketplaces/shopify/live/products?shopId=${"b".repeat(24)}&status=ACTIVE`), { params: Promise.resolve({ platform: "shopify" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireApiActor).toHaveBeenCalledWith(expect.any(NextRequest), ["marketplace:live"]);
    expect(mocks.listMarketplaceLive).toHaveBeenCalledWith("shopify", expect.anything(), "products", expect.objectContaining({ shopId: "b".repeat(24) }));
    expect(body).toMatchObject({ data: [{ externalId: "product-1", title: "Product" }], page: { nextCursor: "next" }, meta: { source: "live" } });
  });
});
