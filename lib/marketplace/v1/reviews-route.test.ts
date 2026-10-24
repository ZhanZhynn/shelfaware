import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ actor: vi.fn(), rate: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/require-api-scope", async () => ({ ...await vi.importActual("@/lib/auth/require-api-scope"), requireApiActor: m.actor }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: m.rate, defaultRateLimits: { standard: {} } }));
vi.mock("@/lib/shopee/reviews-report", async () => ({ ...await vi.importActual("@/lib/shopee/reviews-report"), getShopeeReviews: m.report }));
import { ApiScopeError } from "@/lib/auth/require-api-scope";
import { ApiTokenAuthenticationError } from "@/lib/auth/api-token";
import { ReviewReportError } from "@/lib/shopee/reviews-report";
import { reviewsMarketplaceGet } from "./reviews-route";
const request = () => new NextRequest("http://localhost/api/v1/marketplaces/shopee/reviews?shopId=shop", { headers: { "x-request-id": "review-request" } });
beforeEach(() => { vi.clearAllMocks(); m.actor.mockResolvedValue({ authType: "api_token", tokenId: "token", user: { id: "actor" } }); m.rate.mockResolvedValue(null); m.report.mockResolvedValue({ data: [], coverage: { state: "limited" } }); });
describe("review API scope and error handling", () => {
  it("requires read scope and emits uncached correlated data", async () => {
    const response = await reviewsMarketplaceGet(request(), "shopee", "list"); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toMatchObject({ apiVersion: "2026-shopee-reviews-v1", requestId: "review-request" }); expect(m.actor).toHaveBeenCalledWith(expect.anything(), ["marketplace:read"]);
  });
  it.each([[new ApiScopeError(), 403], [new ApiTokenAuthenticationError(), 401], [new Error("private"), 500]])("redacts authentication errors", async (error, status) => {
    m.actor.mockRejectedValue(error); const response = await reviewsMarketplaceGet(request(), "shopee", "list"); expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("private");
  });
  it("handles unsupported platforms, rate limits, invalid filters and storage failures", async () => {
    expect((await reviewsMarketplaceGet(request(), "shopify", "list")).status).toBe(404);
    m.rate.mockResolvedValueOnce(NextResponse.json({}, { status: 429 })); expect((await reviewsMarketplaceGet(request(), "shopee", "list")).status).toBe(429);
    m.report.mockRejectedValueOnce(new ReviewReportError("INVALID_FILTER", "Invalid filters")); expect((await reviewsMarketplaceGet(request(), "shopee", "list")).status).toBe(422);
    m.report.mockRejectedValueOnce(new Error("private")); const response = await reviewsMarketplaceGet(request(), "shopee", "list"); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
