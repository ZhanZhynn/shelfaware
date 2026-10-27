import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  shopee: vi.fn(), lazada: vi.fn(), tiktok: vi.fn(), sdkFactory: vi.fn(),
  search: vi.fn(), detail: vi.fn(), lazadaPage: vi.fn(), lazadaItems: vi.fn(), tiktokPage: vi.fn(), tiktokDetails: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: m.shopee }, lazadaShop: { findFirst: m.lazada }, tikTokShop: { findFirst: m.tiktok } } }));
vi.mock("@/lib/shopee/server", () => ({ getTransientShopeeSDK: m.sdkFactory }));
vi.mock("@/lib/lazada/server", () => ({ createLazadaShopContext: (value: unknown) => value }));
vi.mock("@/lib/lazada/custom-api", () => ({ getOrdersPageCustom: m.lazadaPage, getMultipleOrderItemsCustom: m.lazadaItems }));
vi.mock("@/lib/tiktok/custom-api", () => ({ searchOrders: m.tiktokPage, getOrderDetail: m.tiktokDetails }));

import { createSlaProvider, slaShopTimezone } from "./providers";
import { getShopeeSlaPackages, searchShopeeSlaPackages } from "./shopee-contract";
const cursor = { queue: 0, cursor: "", seen: [] };
const sdk = { order: { searchPackageList: m.search, getPackageDetail: m.detail } };
const typedSdk = () => sdk as unknown as Parameters<typeof searchShopeeSlaPackages>[0];
const shop = { id: "shop", userId: "owner", shopId: 123, region: "MY", countryCode: "my", accessToken: "PRIVATE_TOKEN", refreshToken: "PRIVATE_REFRESH", tokenExpiry: new Date("2030-01-01Z"), refreshExpiry: null, sellerId: "seller", shopCipher: "cipher" };
beforeEach(() => {
  vi.resetAllMocks();
  for (const find of [m.shopee, m.lazada, m.tiktok]) find.mockResolvedValue(shop);
  m.sdkFactory.mockReturnValue(sdk);
  m.search.mockResolvedValue({ response: { packages_list: [{ order_sn: "ORDER", package_number: "PKG" }], pagination: { more: false } } });
  m.detail.mockResolvedValue({ response: { package_list: [{ order_sn: "ORDER", package_number: "PKG", fulfillment_status: "LOGISTICS_READY", is_shipment_arranged: false, ship_by_date: 1793095200 }] } });
});

describe("documented Shopee package contract", () => {
  it("uses nested pagination and gets deadlines from package details, not the search result", async () => {
    const provider = await createSlaProvider("shopee", "shop", ["owner"]);
    const result = await provider.discover(cursor);
    expect(m.search).toHaveBeenCalledWith({ filter: { package_status: 1, fulfillment_type: 2, invoice_pending: false }, pagination: { page_size: 50, cursor: "" }, sort: { sort_type: 1, ascending: true } });
    expect(m.detail).toHaveBeenCalledWith({ package_number_list: ["PKG"] });
    expect(result.units).toMatchObject([{ packageExternalId: "PKG", deadlineAt: "2026-10-27T10:00:00.000Z", stage: "arrange-shipment" }]);
    expect(result.next).toEqual({ queue: 1, cursor: "", seen: [] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(m.shopee).toHaveBeenCalledWith({ where: { id: "shop", userId: { in: ["owner"] } } });
  });

  it("does not accept the SDK's obsolete response as an empty backlog", async () => {
    m.search.mockResolvedValue({ response: { package_list: [], more: false } });
    await expect(searchShopeeSlaPackages(typedSdk(), 1)).rejects.toMatchObject({ code: "SLA_RESPONSE_INVALID" });
  });

  it("rejects stalled cursors, response warnings, missing requested packages and cross-order identities", async () => {
    m.search.mockResolvedValueOnce({ response: { packages_list: [], pagination: { more: true, next_cursor: "next" } } });
    await expect(searchShopeeSlaPackages(typedSdk(), 1)).rejects.toMatchObject({ code: "SLA_PAGINATION_STALLED" });
    m.search.mockResolvedValueOnce({ warning: "private provider text", response: {} });
    await expect(searchShopeeSlaPackages(typedSdk(), 1)).rejects.toMatchObject({ code: "SLA_PROVIDER_WARNING" });
    m.detail.mockResolvedValueOnce({ response: { package_list: [] } });
    await expect(getShopeeSlaPackages(typedSdk(), ["PKG"])).rejects.toMatchObject({ code: "SLA_RESPONSE_INVALID" });
    m.detail.mockResolvedValueOnce({ response: { package_list: [{ order_sn: "OTHER", package_number: "PKG" }] } });
    await expect((await createSlaProvider("shopee", "shop", ["owner"])).discover(cursor)).rejects.toMatchObject({ code: "SLA_RESPONSE_INVALID" });
  });

  it("traverses processed and invoice-blocked queues and detects cycles", async () => {
    const provider = await createSlaProvider("shopee", "shop", ["owner"]);
    expect((await provider.discover({ ...cursor, queue: 5 })).next).toBeNull();
    expect(m.search).toHaveBeenLastCalledWith(expect.objectContaining({ filter: { package_status: 3, fulfillment_type: 2, invoice_pending: true } }));
    m.search.mockResolvedValueOnce({ response: { packages_list: [{ order_sn: "ORDER", package_number: "PKG" }], pagination: { more: true, next_cursor: "old" } } });
    await expect(provider.discover({ queue: 1, cursor: "current", seen: ["old"] })).rejects.toMatchObject({ code: "SLA_PAGINATION_STALLED" });
  });
});

describe("Lazada and TikTok operational collection", () => {
  it("discovers older Lazada orders and enriches item deadlines rather than copying a header promise", async () => {
    m.lazadaPage.mockResolvedValue({ orders: [{ order_id: "12345678901234567890", promised_shipping_times: "ignored" }], total: 1 });
    m.lazadaItems.mockResolvedValue([{ order_id: "12345678901234567890", order_items: [{ order_item_id: "LINE", package_id: "PKG", status: "ready_to_ship", is_fbl: "0", sla_time_stamp: "2026-10-27T23:59:59+08:00", recipient_address: { private: true } }] }]);
    const result = await (await createSlaProvider("lazada", "shop", ["owner"])).discover(cursor);
    expect(m.lazadaPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ created_after: "2000-01-01T00:00:00+00:00", status: "pending", limit: 50 }));
    expect(result.units).toMatchObject([{ orderExternalId: "12345678901234567890", itemExternalId: "LINE", deadlineSource: "sla_time_stamp", deadlineAt: "2026-10-27T15:59:59.000Z" }]);
    expect(JSON.stringify(result)).not.toContain("recipient_address");
    m.lazadaItems.mockResolvedValueOnce([]);
    await expect((await createSlaProvider("lazada", "shop", ["owner"])).discover(cursor)).rejects.toMatchObject({ code: "SLA_RESPONSE_INVALID" });
  });

  it("marks Lazada's offset cap as limited instead of reporting a complete zero", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ order_id: String(i + 1) }));
    m.lazadaPage.mockResolvedValue({ orders: rows, total: 6000 });
    m.lazadaItems.mockResolvedValue(rows.map((row) => ({ ...row, order_items: [{ order_item_id: `LINE${row.order_id}`, status: "pending", is_fbl: "0" }] })));
    const page = await (await createSlaProvider("lazada", "shop", ["owner"])).discover({ ...cursor, cursor: "4950" });
    expect(page.limited).toBe(true);
    expect(page.next).toEqual({ queue: 1, cursor: "", seen: [] });
  });

  it("uses status-only TikTok discovery and actual-version detail without a recent creation filter", async () => {
    m.tiktokPage.mockResolvedValue({ orders: [{ id: "ORDER" }], next_page_token: "", total_count: 1 });
    m.tiktokDetails.mockResolvedValue({ orders: [{ id: "ORDER", status: "AWAITING_SHIPMENT", fulfillment_type: "FULFILLMENT_BY_SELLER" }] });
    const result = await (await createSlaProvider("tiktok", "shop", ["owner"])).discover({ ...cursor, queue: 1 });
    expect(m.tiktokPage).toHaveBeenCalledWith("PRIVATE_TOKEN", "cipher", { order_status: "AWAITING_SHIPMENT" }, 50, undefined, "create_time", "ASC", true);
    expect(result.units).toMatchObject([{ orderExternalId: "ORDER", sourceVersion: "tiktok-order-202309", deadlineAt: null, deadlineState: "missing" }]);
    m.tiktokDetails.mockResolvedValueOnce({ orders: [{ id: "OTHER" }] });
    await expect((await createSlaProvider("tiktok", "shop", ["owner"])).discover(cursor)).rejects.toMatchObject({ code: "SLA_RESPONSE_INVALID" });
  });

  it("denies unknown shops and expired authorizations before any provider operation", async () => {
    m.shopee.mockResolvedValueOnce(null);
    await expect(createSlaProvider("shopee", "foreign", ["owner"])).rejects.toMatchObject({ status: 404 });
    m.tiktok.mockResolvedValueOnce({ ...shop, tokenExpiry: new Date("2001-01-01Z") });
    await expect(createSlaProvider("tiktok", "shop", ["owner"])).rejects.toMatchObject({ code: "SLA_PROVIDER_AUTH_REQUIRED" });
    expect(m.search).not.toHaveBeenCalled(); expect(m.tiktokPage).not.toHaveBeenCalled();
    expect(slaShopTimezone("US")).toBeNull(); expect(slaShopTimezone("my")).toBe("Asia/Kuala_Lumpur");
  });
});
