import { beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => ({ shop: vi.fn(), itemList: vi.fn(), itemInfo: vi.fn(), orderList: vi.fn(), orderInfo: vi.fn(), lazadaOrders: vi.fn(), lazadaItems: vi.fn(), lazadaProducts: vi.fn(), tiktokOrders: vi.fn(), tiktokProducts: vi.fn(), graphql: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: m.shop }, lazadaShop: { findFirst: m.shop }, tikTokShop: { findFirst: m.shop }, shopifyShop: { findFirst: m.shop } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: async () => ["owner"] }));
vi.mock("@/lib/shopee/server", () => ({ getTransientShopeeSDK: () => ({ product: { getItemList: m.itemList, getItemBaseInfo: m.itemInfo }, order: { getOrderList: m.orderList, getOrdersDetail: m.orderInfo } }) }));
vi.mock("@/lib/lazada/server", () => ({ createLazadaShopContext: (shop: unknown) => shop }));
vi.mock("@/lib/lazada/custom-api", () => ({ getOrdersPageCustom: m.lazadaOrders, getMultipleOrderItemsCustom: m.lazadaItems, getProductsCustom: m.lazadaProducts }));
vi.mock("@/lib/tiktok/custom-api", () => ({ searchOrders: m.tiktokOrders, searchProducts: m.tiktokProducts }));
vi.mock("@/lib/shopify/server", () => ({ shopifyGraphQL: m.graphql }));
import { classifyLiveProviderError, listMarketplaceLive, MarketplaceLiveNotFoundError, parseLiveQuery } from "./live";

const user = { id: "owner", role: "admin" };
const shopId = "a".repeat(24);
beforeEach(() => {
  vi.resetAllMocks();
  m.shop.mockResolvedValue({ shopId: 123, shopDomain: "shop.myshopify.com", countryCode: "my", accessToken: "token", refreshToken: "refresh", shopCipher: "cipher", tokenExpiry: null });
});

describe("live product adapter contracts", () => {
  it("enriches Shopee product IDs and preserves a genuine zero price and stock", async () => {
    m.itemList.mockResolvedValue({ response: { item: [{ item_id: 1 }], has_next_page: true } });
    m.itemInfo.mockResolvedValue({ response: { item_list: [{ item_id: 1, item_name: "Box", item_sku: "BOX", price_info: [{ current_price: "0.00", original_price: 15 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } }] } });
    const result = await listMarketplaceLive("shopee", user, "products", { shopId, limit: 1, cursor: "3" });
    expect(result).toMatchObject({ data: [{ externalId: "1", sku: "BOX", price: 0, originalPrice: 15, stock: 0 }], page: { nextCursor: "4" } });
    expect(m.itemList).toHaveBeenCalledWith({ offset: 3, page_size: 1, item_status: ["NORMAL"] });
    expect(m.itemInfo).toHaveBeenCalledWith({ item_id_list: [1] });
  });

  it("does not request Shopee details for an empty list and rejects invalid offsets", async () => {
    m.itemList.mockResolvedValue({ response: { item: [] } });
    expect(await listMarketplaceLive("shopee", user, "products", { shopId, limit: 1 })).toMatchObject({ data: [], page: { nextCursor: null } });
    expect(m.itemInfo).not.toHaveBeenCalled();
    for (const cursor of ["-1", "1.5", "10001", "invalid"]) await expect(listMarketplaceLive("shopee", user, "products", { shopId, limit: 1, cursor })).rejects.toThrow("Invalid cursor");
  });

  it("maps Lazada product facts and advances offset pagination without inventing variant completeness", async () => {
    m.lazadaProducts.mockResolvedValue([{ item_id: 10, attributes: { name: "Box" }, skus: [{ SellerSku: "BOX", price: "12.50", special_price: "0.00", quantity: 0 }] }]);
    expect(await listMarketplaceLive("lazada", user, "products", { shopId, limit: 1, cursor: "2" })).toMatchObject({ data: [{ externalId: "10", price: 12.5, specialPrice: 0, stock: 0 }], page: { nextCursor: "3" } });
    expect(m.lazadaProducts).toHaveBeenCalledWith(expect.anything(), { filter: "live", limit: 1, offset: 2 });
  });

  it("maps TikTok product identifiers and opaque page tokens", async () => {
    m.tiktokProducts.mockResolvedValue({ products: [{ product_id: "p", title: "Box", seller_sku: "BOX", status: "ACTIVATE", create_time: 1700000000 }], next_page_token: "next" });
    expect(await listMarketplaceLive("tiktok", user, "products", { shopId, limit: 1, status: "ACTIVATE", cursor: "page" })).toMatchObject({ data: [{ externalId: "p", sku: "BOX", createdAt: "2023-11-14T22:13:20.000Z" }], page: { nextCursor: "next" } });
    expect(m.tiktokProducts).toHaveBeenCalledWith("token", "cipher", { status: "ACTIVATE" }, 1, "page");
  });

  it("maps Shopify zero-valued product facts while retaining opaque cursors", async () => {
    m.graphql.mockResolvedValue({ products: { nodes: [{ id: "p", title: "Box", totalInventory: 0, variants: { nodes: [{ sku: "BOX", price: "0.00", compareAtPrice: "12.00" }] } }], pageInfo: { hasNextPage: true, endCursor: "next" } } });
    expect(await listMarketplaceLive("shopify", user, "products", { shopId, limit: 1, status: "ACTIVE", cursor: "page" })).toMatchObject({ data: [{ externalId: "p", sku: "BOX", price: 0, originalPrice: 12, stock: 0 }], page: { nextCursor: "next" } });
    expect(m.graphql).toHaveBeenCalledWith("shop.myshopify.com", "token", expect.any(String), { first: 1, after: "page", query: "status:ACTIVE" });
  });
});

describe("live order completeness and filter parity", () => {
  it("rejects Lazada short pages, duplicate IDs and offset-cap truncation", async () => {
    m.lazadaOrders.mockResolvedValue({ orders: [{ order_id: 1 }], total: 2 });
    await expect(listMarketplaceLive("lazada", user, "orders", { shopId, limit: 2 })).rejects.toMatchObject({ code: "INCOMPLETE_PAGINATION" });
    m.lazadaOrders.mockResolvedValue({ orders: [{ order_id: 1 }, { order_id: 1 }], total: 2 });
    await expect(listMarketplaceLive("lazada", user, "orders", { shopId, limit: 2 })).rejects.toMatchObject({ code: "MALFORMED_ORDER_IDS" });
    await expect(listMarketplaceLive("lazada", user, "orders", { shopId, limit: 2, cursor: "5000" })).rejects.toThrow("offset cap");
    expect(m.lazadaItems).not.toHaveBeenCalled();
  });

  it.each([{ cancelledAt: "2026-10-01", closed: true, status: "CANCELLED", revenue: 0 }, { cancelledAt: null, closed: true, status: "CLOSED", revenue: 12.5 }, { cancelledAt: null, closed: false, status: "OPEN", revenue: 12.5 }])("maps Shopify order lifecycle to $status without discarding totals", async ({ cancelledAt, closed, status, revenue }) => {
    m.graphql.mockResolvedValue({ orders: { nodes: [{ id: "o", cancelledAt, closed, totalPriceSet: { shopMoney: { amount: "12.50", currencyCode: "MYR" } } }], pageInfo: { hasNextPage: false, endCursor: null } } });
    expect(await listMarketplaceLive("shopify", user, "orders", { shopId, limit: 1 })).toMatchObject({ data: [{ status, totalAmount: 12.5, currency: "MYR", revenueAmount: revenue }] });
  });

  knownGap("KNOWN GAP LIVE-SHOPEE-DETAILS: incomplete detail enrichment must not look complete", async () => {
    m.orderList.mockResolvedValue({ response: { order_list: [{ order_sn: "missing" }], more: false } });
    m.orderInfo.mockResolvedValue({ response: { order_list: [] } });
    const result = await listMarketplaceLive("shopee", user, "orders", { shopId, limit: 1 });
    expect(result).toHaveProperty("coverage.state", "partial");
  });

  knownGap("KNOWN GAP LIVE-TIKTOK-BOUNDARY: an inclusive upper second must be included in the live request", async () => {
    m.tiktokOrders.mockResolvedValue({ orders: [] });
    const to = "2026-10-21T12:00:00Z";
    await listMarketplaceLive("tiktok", user, "orders", { shopId, limit: 1, createdAfter: "2026-10-20T12:00:00Z", createdBefore: to });
    expect(m.tiktokOrders.mock.calls[0]![2].create_time_lt).toBe(new Date(to).getTime() / 1000 + 1);
  });
});

describe("live authorization, strict parsing and error classification", () => {
  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("rejects an unavailable owned %s shop for both resources", async (platform) => {
    m.shop.mockResolvedValue(null);
    for (const resource of ["orders", "products"] as const) await expect(listMarketplaceLive(platform, user, resource, { shopId, limit: 1 })).rejects.toBeInstanceOf(MarketplaceLiveNotFoundError);
    expect(m.graphql).not.toHaveBeenCalled();
    expect(m.itemList).not.toHaveBeenCalled();
  });

  it.each([
    { params: { limit: "0" }, resource: "orders" as const }, { params: { limit: "51" }, resource: "orders" as const },
    { params: { unknown: "value" }, resource: "orders" as const }, { params: { createdAfter: "invalid" }, resource: "orders" as const },
    { params: { createdAfter: "2026-10-02T00:00:00Z", createdBefore: "2026-10-01T00:00:00Z" }, resource: "orders" as const },
    { params: { createdAfter: "2026-10-01T00:00:00Z" }, resource: "products" as const },
  ])("rejects invalid filters before a provider query: $params", ({ params, resource }) => {
    const query = new URLSearchParams({ shopId });
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
    expect(() => parseLiveQuery(query, resource)).toThrow();
  });

  it.each([{ status: 401, code: "LIVE_PROVIDER_AUTH_REQUIRED" }, { status: 429, code: "LIVE_PROVIDER_RATE_LIMITED" }, { status: 404, code: "LIVE_PROVIDER_UNSUPPORTED" }, { status: 503, code: "LIVE_PROVIDER_TEMPORARY" }])("classifies generic HTTP $status without exposing the raw failure", ({ status, code }) => {
    expect(classifyLiveProviderError(Object.assign(new Error("private detail"), { status }))).toMatchObject({ code });
  });
});
