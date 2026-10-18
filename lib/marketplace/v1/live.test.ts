import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  shopeeShopFindFirst: vi.fn(),
  getTransientShopeeSDK: vi.fn(),
  getOrderList: vi.fn(),
  getOrdersDetail: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: mocks.shopeeShopFindFirst } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));
vi.mock("@/lib/shopee/server", () => ({ getTransientShopeeSDK: mocks.getTransientShopeeSDK }));
vi.mock("@/lib/lazada/server", () => ({ createLazadaShopContext: vi.fn() }));
vi.mock("@/lib/lazada/custom-api", () => ({ getOrdersCustom: vi.fn(), getProductsCustom: vi.fn() }));
vi.mock("@/lib/tiktok/custom-api", () => ({ searchOrders: vi.fn(), searchProducts: vi.fn() }));
vi.mock("@/lib/shopify/server", () => ({ shopifyGraphQL: vi.fn() }));

import { listMarketplaceLive, liveRevenue, MarketplaceLiveValidationError, parseLiveQuery } from "./live";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
  mocks.shopeeShopFindFirst.mockResolvedValue({ shopId: 123, accessToken: "access", refreshToken: "refresh", tokenExpiry: null });
  mocks.getTransientShopeeSDK.mockReturnValue({ order: { getOrderList: mocks.getOrderList, getOrdersDetail: mocks.getOrdersDetail } });
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
