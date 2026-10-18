import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  shopeeShopFindFirst: vi.fn(), lazadaShopFindFirst: vi.fn(), tikTokShopFindFirst: vi.fn(), shopifyShopFindFirst: vi.fn(),
  shopeeOrderFindMany: vi.fn(), lazadaOrderFindMany: vi.fn(), tikTokOrderFindMany: vi.fn(), shopifyOrderFindMany: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ prisma: {
  shopeeShop: { findFirst: mocks.shopeeShopFindFirst }, lazadaShop: { findFirst: mocks.lazadaShopFindFirst }, tikTokShop: { findFirst: mocks.tikTokShopFindFirst }, shopifyShop: { findFirst: mocks.shopifyShopFindFirst },
  shopeeOrder: { findMany: mocks.shopeeOrderFindMany }, lazadaOrder: { findMany: mocks.lazadaOrderFindMany }, tikTokOrder: { findMany: mocks.tikTokOrderFindMany }, shopifyOrder: { findMany: mocks.shopifyOrderFindMany },
} }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));

import { decodeMarketplaceCursor, encodeMarketplaceCursor, listMarketplaceOrders, MarketplaceV1ValidationError, parseLocalQuery } from "./local-catalog";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
  mocks.shopeeShopFindFirst.mockResolvedValue({ id: "a".repeat(24) });
  mocks.lazadaShopFindFirst.mockResolvedValue({ id: "a".repeat(24) });
  mocks.tikTokShopFindFirst.mockResolvedValue({ id: "a".repeat(24) });
  mocks.shopifyShopFindFirst.mockResolvedValue({ id: "a".repeat(24) });
  mocks.shopeeOrderFindMany.mockResolvedValue([]);
  mocks.lazadaOrderFindMany.mockResolvedValue([]);
  mocks.tikTokOrderFindMany.mockResolvedValue([]);
  mocks.shopifyOrderFindMany.mockResolvedValue([]);
});

describe("v1 local marketplace queries", () => {
  it("parses strict order filters", () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId: "a".repeat(24), status: "READY_TO_SHIP", limit: "25", createdAfter: "2026-01-01T00:00:00.000Z" }), "orders");
    expect(query).toMatchObject({ shopId: "a".repeat(24), status: "READY_TO_SHIP", limit: 25 });
  });

  it("rejects duplicate, unknown, and inverted filters", () => {
    expect(() => parseLocalQuery(new URLSearchParams("limit=1&limit=2"), "orders")).toThrow(MarketplaceV1ValidationError);
    expect(() => parseLocalQuery(new URLSearchParams("page=1"), "orders")).toThrow(MarketplaceV1ValidationError);
    expect(() => parseLocalQuery(new URLSearchParams({ createdAfter: "2026-02-01T00:00:00.000Z", createdBefore: "2026-01-01T00:00:00.000Z" }), "orders")).toThrow(MarketplaceV1ValidationError);
  });

  it("binds cursors to their resource, platform, and filters", () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId: "a".repeat(24), status: "READY_TO_SHIP" }), "orders");
    const cursor = encodeMarketplaceCursor("shopee", "orders", query, "b".repeat(24));

    expect(decodeMarketplaceCursor("shopee", "orders", query, cursor)).toBe("b".repeat(24));
    expect(() => decodeMarketplaceCursor("lazada", "orders", query, cursor)).toThrow(MarketplaceV1ValidationError);
    expect(() => decodeMarketplaceCursor("shopee", "products", query, cursor)).toThrow(MarketplaceV1ValidationError);
  });

  it("keeps default and explicit ingested cursors compatible but isolates source-date cursors", () => {
    const defaultQuery = parseLocalQuery(new URLSearchParams({ createdAfter: "2026-01-01T00:00:00.000Z" }), "orders");
    const ingestedQuery = parseLocalQuery(new URLSearchParams({ createdAfter: "2026-01-01T00:00:00.000Z", dateBasis: "ingested" }), "orders");
    const sourceQuery = parseLocalQuery(new URLSearchParams({ createdAfter: "2026-01-01T00:00:00.000Z", dateBasis: "source" }), "orders");
    const cursor = encodeMarketplaceCursor("shopee", "orders", defaultQuery, "b".repeat(24));

    expect(decodeMarketplaceCursor("shopee", "orders", ingestedQuery, cursor)).toBe("b".repeat(24));
    expect(() => decodeMarketplaceCursor("shopee", "orders", sourceQuery, cursor)).toThrow(MarketplaceV1ValidationError);
  });

  it.each([
    ["shopee", "shopeeCreatedAt", "shopeeOrderFindMany"],
    ["lazada", "lazadaCreatedAt", "lazadaOrderFindMany"],
    ["tiktok", "tiktokCreatedAt", "tikTokOrderFindMany"],
    ["shopify", "shopifyCreatedAt", "shopifyOrderFindMany"],
  ] as const)("filters %s by its source timestamp with an ingestion fallback", async (platform, sourceField, method) => {
    const query = parseLocalQuery(new URLSearchParams({ shopId: "a".repeat(24), createdAfter: "2026-01-01T00:00:00.000Z", createdBefore: "2026-01-02T00:00:00.000Z", dateBasis: "source" }), "orders");

    await listMarketplaceOrders(platform, { id: "actor-1", role: "admin" }, query);

    const where = (mocks[method] as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { [sourceField]: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-02T00:00:00.000Z") } },
      { [sourceField]: null, createdAt: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-02T00:00:00.000Z") } },
    ]);
    expect((mocks[method] as ReturnType<typeof vi.fn>).mock.calls[0]![0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("continues to filter omitted dateBasis by ingestion createdAt", async () => {
    const query = parseLocalQuery(new URLSearchParams({ createdAfter: "2026-01-01T00:00:00.000Z" }), "orders");

    await listMarketplaceOrders("shopee", { id: "actor-1", role: "admin" }, query);

    expect(mocks.shopeeOrderFindMany.mock.calls[0]![0].where).toMatchObject({ createdAt: { gte: new Date("2026-01-01T00:00:00.000Z") } });
    expect(mocks.shopeeOrderFindMany.mock.calls[0]![0].where).not.toHaveProperty("OR");
  });

  it("includes persisted Shopee shipping facts in local list results", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([{
      id: "b".repeat(24), shopId: "a".repeat(24), shopeeOrderId: "ORDER-1", orderStatus: "READY_TO_SHIP", paymentStatus: null, totalAmount: 10, currency: "MYR", trackingNumber: null, trackingCarrier: null,
      shipByDate: new Date("2026-01-03T00:00:00.000Z"), packageNumber: "PACKAGE-1", fulfillmentStatus: "LOGISTICS_READY", daysToShip: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: null, shopeeCreatedAt: null, shopeeUpdatedAt: null,
    }]);
    const query = parseLocalQuery(new URLSearchParams(), "orders");

    const result = await listMarketplaceOrders("shopee", { id: "actor-1", role: "admin" }, query);

    expect(result.data[0]).toMatchObject({ shipByDate: "2026-01-03T00:00:00.000Z", packageNumber: "PACKAGE-1", fulfillmentStatus: "LOGISTICS_READY", daysToShip: 2 });
  });
});
