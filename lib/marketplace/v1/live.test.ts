import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  shopeeShopFindFirst: vi.fn(),
  getTransientShopeeSDK: vi.fn(),
  getOrderList: vi.fn(),
  getOrdersDetail: vi.fn(),
  lazadaShopFindFirst: vi.fn(), lazadaOrdersPage: vi.fn(), lazadaItems: vi.fn(),
  tikTokShopFindFirst: vi.fn(), tiktokOrders: vi.fn(),
  shopifyShopFindFirst: vi.fn(), shopifyGraphQL: vi.fn(),
  requireApiActor: vi.fn(), withRateLimit: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: mocks.shopeeShopFindFirst }, lazadaShop: { findFirst: mocks.lazadaShopFindFirst }, tikTokShop: { findFirst: mocks.tikTokShopFindFirst }, shopifyShop: { findFirst: mocks.shopifyShopFindFirst } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));
vi.mock("@/lib/shopee/server", () => ({ getTransientShopeeSDK: mocks.getTransientShopeeSDK }));
vi.mock("@/lib/lazada/server", () => ({ createLazadaShopContext: (shop: unknown) => shop }));
vi.mock("@/lib/lazada/custom-api", () => ({ getOrdersPageCustom: mocks.lazadaOrdersPage, getMultipleOrderItemsCustom: mocks.lazadaItems, getProductsCustom: vi.fn() }));
vi.mock("@/lib/tiktok/custom-api", () => ({ searchOrders: mocks.tiktokOrders, searchProducts: vi.fn() }));
vi.mock("@/lib/shopify/server", () => ({ shopifyGraphQL: mocks.shopifyGraphQL }));
vi.mock("@/lib/auth/require-api-scope", () => ({ requireApiActor: mocks.requireApiActor, ApiScopeError: class extends Error {} }));
vi.mock("@/lib/auth/api-token", () => ({ ApiTokenAuthenticationError: class extends Error {} }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: mocks.withRateLimit, defaultRateLimits: { standard: {} } }));

import { classifyLiveProviderError, listMarketplaceLive, liveRevenue, MarketplaceLiveValidationError, parseLiveQuery } from "./live";
import { LazadaProviderError } from "@/lib/lazada/provider-error";
import { TikTokProviderError } from "@/lib/tiktok/provider-error";
import { liveMarketplaceGet } from "./live-route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
  mocks.shopeeShopFindFirst.mockResolvedValue({ shopId: 123, accessToken: "access", refreshToken: "refresh", tokenExpiry: null });
  mocks.getTransientShopeeSDK.mockReturnValue({ order: { getOrderList: mocks.getOrderList, getOrdersDetail: mocks.getOrdersDetail } });
  mocks.tikTokShopFindFirst.mockResolvedValue({ accessToken: "seller-token", shopCipher: "shop-cipher" });
  mocks.requireApiActor.mockResolvedValue({ user: { id: "actor-1", role: "admin" }, authType: "api_token", tokenId: "token-1" });
  mocks.withRateLimit.mockResolvedValue(null);
});

describe("live Shopify orders", () => {
  it("quotes timestamp filters so a today query does not include yesterday", async () => {
    mocks.shopifyShopFindFirst.mockResolvedValue({ shopDomain: "shop.myshopify.com", accessToken: "shop-token" });
    mocks.shopifyGraphQL.mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    const query = parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), createdAfter: "2026-10-21T00:00:00+08:00", createdBefore: "2026-10-21T23:59:59+08:00" }), "orders");
    await expect(listMarketplaceLive("shopify", { id: "owner", role: null }, "orders", query)).resolves.toMatchObject({ data: [], page: { nextCursor: null } });
    expect(mocks.shopifyGraphQL).toHaveBeenCalledWith("shop.myshopify.com", "shop-token", expect.any(String), expect.objectContaining({ query: 'created_at:>="2026-10-20T16:00:00.000Z" created_at:<="2026-10-21T15:59:59.000Z"' }));
  });
});

describe("live TikTok orders", () => {
  it("uses lowercase create_time with the requested shop and bounded filters", async () => {
    mocks.tiktokOrders.mockResolvedValue({ orders: [{ id: "order-1", status: "COMPLETED", payment: { total_amount: "18.50", currency: "MYR" } }], next_page_token: "next-page" });
    const query = parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), limit: "1", cursor: "page-token", status: "COMPLETED", createdAfter: "2026-08-01T00:00:00+08:00", createdBefore: "2026-09-01T00:00:00+08:00" }), "orders");

    const result = await listMarketplaceLive("tiktok", { id: "actor-1", role: "admin" }, "orders", query);

    expect(mocks.tikTokShopFindFirst).toHaveBeenCalledWith({ where: { id: "a".repeat(24), userId: { in: ["owner-1"] } }, select: { accessToken: true, shopCipher: true } });
    expect(mocks.tiktokOrders).toHaveBeenCalledWith("seller-token", "shop-cipher", { order_status: "COMPLETED", create_time_ge: 1785513600, create_time_lt: 1788192000 }, 1, "page-token", "create_time", "DESC");
    expect(result).toMatchObject({ data: [{ externalId: "order-1", totalAmount: 18.5, currency: "MYR" }], page: { limit: 1, nextCursor: "next-page" } });
  });

  it.each([
    { status: 400, providerCode: 36009004, message: "Invalid sort field", code: "LIVE_PROVIDER_INVALID_QUERY", retryable: false },
    { status: 200, providerCode: 36009004, message: "Invalid sort field", code: "LIVE_PROVIDER_INVALID_QUERY", retryable: false },
    { status: 401, providerCode: 12345, message: "", code: "LIVE_PROVIDER_AUTH_REQUIRED", retryable: false },
    { status: 200, providerCode: 12345, message: "Access token is invalid", code: "LIVE_PROVIDER_AUTH_REQUIRED", retryable: false },
    { status: 429, providerCode: 12345, message: "", code: "LIVE_PROVIDER_RATE_LIMITED", retryable: true },
    { status: 200, providerCode: 12345, message: "Too many requests", code: "LIVE_PROVIDER_RATE_LIMITED", retryable: true },
    { status: 404, providerCode: 12345, message: "", code: "LIVE_PROVIDER_UNSUPPORTED", retryable: false },
    { status: 503, providerCode: 12345, message: "", code: "LIVE_PROVIDER_TEMPORARY", retryable: true },
  ])("maps HTTP $status to $code while retaining safe provider identifiers", ({ status, providerCode, message, code, retryable }) => {
    expect(classifyLiveProviderError(new TikTokProviderError(providerCode, status, "provider-id", message)))
      .toMatchObject({ code, retryable, provider: { code: String(providerCode), requestId: "provider-id" } });
  });

  it("returns a non-retryable 422 with the provider code and request ID for invalid sorting", async () => {
    mocks.tiktokOrders.mockRejectedValue(new TikTokProviderError(36009004, 400, "provider-id", "SortField is invalid, allowed values: create_time,update_time."));
    const request = new NextRequest(`http://localhost/api/v1/marketplaces/tiktok/live/orders?shopId=${"a".repeat(24)}&limit=1`, { headers: { "x-request-id": "shelfaware-id" } });

    const response = await liveMarketplaceGet("orders", request, { params: Promise.resolve({ platform: "tiktok" }) });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get("x-request-id")).toBe("shelfaware-id");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ error: { code: "LIVE_PROVIDER_INVALID_QUERY", requestId: "shelfaware-id", details: { platform: "tiktok", retryable: false, retryAfterSeconds: null, providerCode: "36009004", providerRequestId: "provider-id" } } });
    expect(JSON.stringify(body)).not.toMatch(/seller-token|shop-cipher|SortField is invalid/);
  });
});

describe("live Lazada source contracts", () => {
  it("uses provider totals, canonical status, line currency, and explicit amount bases", async () => {
    mocks.lazadaShopFindFirst.mockResolvedValue({ countryCode: "my", tokenExpiry: null });
    mocks.lazadaOrdersPage.mockResolvedValue({ orders: [{ order_id: 10, order_number: "10", statuses: ["confirmed"], price: "20.00", shipping_fee: "3.00", created_at: "2026-08-01 10:00:00 +0800" }], total: 1 });
    mocks.lazadaItems.mockResolvedValue([{ order_id: 10, order_items: [{ order_item_id: 1001, paid_price: "19.00", currency: "MYR" }] }]);
    const result = await listMarketplaceLive("lazada", { id: "owner", role: null }, "orders", { shopId: "a".repeat(24), limit: 1 });
    expect(result.page.nextCursor).toBeNull();
    expect(result.data[0]).toMatchObject({ status: "confirmed", totalAmount: 20, paidMerchandiseAmount: 19, buyerPaidTotalAmount: 22, currency: "MYR", itemRowCount: 1, unitQuantity: null, createdAt: "2026-08-01T02:00:00.000Z" });
  });
  it("reports expired authorization without refreshing credentials in a live read", async () => {
    mocks.lazadaShopFindFirst.mockResolvedValue({ countryCode: "my", tokenExpiry: new Date("2020-01-01") });
    await expect(listMarketplaceLive("lazada", { id: "owner", role: null }, "orders", { shopId: "a".repeat(24), limit: 1 })).rejects.toMatchObject({ code: "LIVE_PROVIDER_AUTH_REQUIRED", retryable: false });
    expect(mocks.lazadaOrdersPage).not.toHaveBeenCalled();
  });
  it("classifies structured provider failures without losing safe request identifiers", () => {
    expect(classifyLiveProviderError(new LazadaProviderError("IllegalAccessToken", 200, "provider-id"))).toMatchObject({ code: "LIVE_PROVIDER_AUTH_REQUIRED", provider: { requestId: "provider-id" } });
    expect(classifyLiveProviderError(new LazadaProviderError("ParameterError", 200))).toMatchObject({ code: "LIVE_PROVIDER_INVALID_QUERY", retryable: false });
    expect(classifyLiveProviderError(new LazadaProviderError("SellerCallLimit", 200))).toMatchObject({ code: "LIVE_PROVIDER_RATE_LIMITED", retryable: true });
  });
});

describe("live marketplace query parsing", () => {
  it("requires the canonical internal shop ID and materializes a bounded order window", () => {
    const query = parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), limit: "10" }), "orders");
    expect(query).toMatchObject({ shopId: "a".repeat(24), limit: 10 });
    expect(query.createdAfter).toBeTruthy();
    expect(query.createdBefore).toBeTruthy();
    expect(new Date(query.createdBefore!).getTime() - new Date(query.createdAfter!).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejects provider shop IDs, duplicate filters, and unbounded date ranges", () => {
    expect(() => parseLiveQuery(new URLSearchParams({ shopId: "provider-shop-id" }), "products")).toThrow(MarketplaceLiveValidationError);
    expect(() => parseLiveQuery(new URLSearchParams(`shopId=${"a".repeat(24)}&status=ACTIVE&status=DRAFT`), "products")).toThrow(MarketplaceLiveValidationError);
    expect(() => parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), createdAfter: "2026-01-01T00:00:00.000Z", createdBefore: "2026-02-02T00:00:00.000Z" }), "orders")).toThrow("Date range must not exceed 31 days");
  });
});

describe("live revenue eligibility", () => {
  it("never counts cancelled or unpaid gross order values as revenue", () => {
    expect(liveRevenue("CANCELLED", 16.57)).toMatchObject({ revenueEligible: false, revenueAmount: 0 });
    expect(liveRevenue("UNPAID", 36.4)).toMatchObject({ revenueEligible: false, revenueAmount: 0 });
    expect(liveRevenue("READY_TO_SHIP", 20.93)).toMatchObject({ revenueEligible: true, revenueAmount: 20.93, revenueBasis: "gross_order_value" });
  });

  it("does not treat missing amounts or unknown statuses as revenue", () => {
    expect(liveRevenue(null, 12)).toMatchObject({ revenueEligible: false, revenueAmount: 0 });
    expect(liveRevenue("   ", 12)).toMatchObject({ revenueEligible: false, revenueAmount: 0 });
    expect(liveRevenue("UNKNOWN", 12)).toMatchObject({ revenueEligible: false, revenueAmount: 0 });
    expect(liveRevenue("", null)).toMatchObject({ revenueEligible: false, revenueAmount: null });
  });

  it("retains denylist eligibility for provider-specific nonempty statuses", () => {
    expect(liveRevenue("ready_to_ship_pending", 20.93)).toMatchObject({ revenueEligible: true, revenueAmount: 20.93 });
    expect(liveRevenue("shipping", 20.93)).toMatchObject({ revenueEligible: true, revenueAmount: 20.93 });
  });
});

describe("live Shopee orders", () => {
  it("normalizes carrier and package facts from the existing detail read without escrow", async () => {
    mocks.getOrderList.mockResolvedValue({ response: {
      order_list: [
        { order_sn: "ORDER-READY", order_status: "READY_TO_SHIP", create_time: 1_767_225_600 },
        { order_sn: "ORDER-MISSING", order_status: "READY_TO_SHIP" },
        { order_sn: "ORDER-UNKNOWN", order_status: "UNKNOWN" },
        { order_sn: "ORDER-INVALID-AMOUNT", order_status: "READY_TO_SHIP" },
        { order_sn: "ORDER-ARRAY-AMOUNT", order_status: "READY_TO_SHIP" },
        { order_sn: "ORDER-OBJECT-AMOUNT", order_status: "READY_TO_SHIP" },
        { order_sn: "ORDER-NUMBER-AMOUNT", order_status: "READY_TO_SHIP" },
      ], more: false,
    } });
    mocks.getOrdersDetail.mockResolvedValue({ response: { order_list: [
      { order_sn: "ORDER-READY", total_amount: "18.50", shipping_carrier: "Shopee Xpress", package_list: [{ package_number: "PACKAGE-1", fulfillment_status: "LOGISTICS_READY", logistics_status: "IN_TRANSIT", tracking_number: "TRACK-1" }] },
      { order_sn: "ORDER-MISSING", total_amount: null },
      { order_sn: "ORDER-UNKNOWN", total_amount: "" },
      { order_sn: "ORDER-INVALID-AMOUNT", total_amount: false },
      { order_sn: "ORDER-ARRAY-AMOUNT", total_amount: [] },
      { order_sn: "ORDER-OBJECT-AMOUNT", total_amount: {} },
      { order_sn: "ORDER-NUMBER-AMOUNT", total_amount: 7 },
    ] } });
    const query = parseLiveQuery(new URLSearchParams({ shopId: "a".repeat(24), createdAfter: "2026-01-01T00:00:00.000Z", createdBefore: "2026-01-02T00:00:00.000Z" }), "orders");

    const result = await listMarketplaceLive("shopee", { id: "actor-1", role: "admin" }, "orders", query);

    expect(mocks.getOrdersDetail).toHaveBeenCalledWith(expect.objectContaining({ response_optional_fields: "total_amount,shipping_carrier,package_list" }));
    expect(JSON.stringify(mocks.getOrdersDetail.mock.calls)).not.toMatch(/escrow/i);
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "ORDER-READY", totalAmount: 18.5, carrier: "Shopee Xpress", packages: [{ packageNumber: "PACKAGE-1", fulfillmentStatus: "LOGISTICS_READY", logisticsStatus: "IN_TRANSIT", trackingNumber: "TRACK-1", carrier: null }], revenueEligible: true }),
      expect.objectContaining({ externalId: "ORDER-MISSING", totalAmount: null, revenueEligible: false, revenueAmount: null, carrier: null, packages: [] }),
      expect.objectContaining({ externalId: "ORDER-UNKNOWN", totalAmount: null, revenueEligible: false, revenueAmount: null }),
      expect.objectContaining({ externalId: "ORDER-INVALID-AMOUNT", totalAmount: null, revenueEligible: false, revenueAmount: null }),
      expect.objectContaining({ externalId: "ORDER-ARRAY-AMOUNT", totalAmount: null, revenueEligible: false, revenueAmount: null }),
      expect.objectContaining({ externalId: "ORDER-OBJECT-AMOUNT", totalAmount: null, revenueEligible: false, revenueAmount: null }),
      expect.objectContaining({ externalId: "ORDER-NUMBER-AMOUNT", totalAmount: 7, revenueEligible: true, revenueAmount: 7 }),
    ]));
    expect(result.data[0]).toMatchObject({ settlement: { reason: "Unavailable because this endpoint does not request Shopee escrow details." } });
  });
});
