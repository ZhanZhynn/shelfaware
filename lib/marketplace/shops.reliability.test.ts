import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn() });
  return { db: { shopeeShop: model(), shopeeOrder: model(), lazadaShop: model(), lazadaOrder: model(), tikTokShop: model(), tikTokOrder: model(), shopifyShop: model(), shopifyOrder: model() } };
});
vi.mock("@/prisma/client", () => ({ prisma: m.db }));
vi.mock("./access", () => ({ marketplaceOwnerIds: async () => ["owner"] }));
import { accessibleMarketplaceShops } from "./shops";

const user = { id: "owner", role: "admin" };
beforeEach(() => {
  vi.resetAllMocks();
  for (const model of Object.values(m.db)) model.findMany.mockResolvedValue([]);
});

describe("owned marketplace shop discovery", () => {
  it("normalizes all platforms and reports only observed single-currency evidence", async () => {
    const lastSyncedAt = new Date("2026-10-21T00:00:00Z");
    m.db.shopeeShop.findMany.mockResolvedValue([{ id: "s", shopId: 123, shopName: "Delta", region: "MY", lastSyncedAt }]);
    m.db.lazadaShop.findMany.mockResolvedValue([{ id: "l", sellerId: "Seller", sellerName: "Alpha", countryCode: "my", lastSyncedAt: null }]);
    m.db.tikTokShop.findMany.mockResolvedValue([{ id: "t", shopId: "TikTok-Shop", shopName: "Charlie", region: "MY", lastSyncedAt }]);
    m.db.shopifyShop.findMany.mockResolvedValue([{ id: "f", shopDomain: "Shop.MyShopify.Com", shopName: "Beta", lastSyncedAt }]);
    m.db.shopeeOrder.findMany.mockResolvedValue([{ shopId: "s", currency: "MYR" }]);
    m.db.lazadaOrder.findMany.mockResolvedValue([{ shopId: "l", currency: "MYR" }, { shopId: "l", currency: "SGD" }]);
    m.db.shopifyOrder.findMany.mockResolvedValue([{ shopId: "f", currency: "USD" }]);
    const result = await accessibleMarketplaceShops(user);
    expect(result.map((shop) => [shop.id, shop.externalId, shop.currency, shop.connectionState])).toEqual([["l", "seller", null, "not-yet-synced"], ["f", "shop.myshopify.com", "USD", "synced"], ["t", "tiktok-shop", null, "synced"], ["s", "123", "MYR", "synced"]]);
    expect(result.find((shop) => shop.id === "s")?.lastSyncedAt).toBe(lastSyncedAt.toISOString());
    for (const model of [m.db.shopeeShop, m.db.lazadaShop, m.db.tikTokShop, m.db.shopifyShop]) expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ["owner"] } } }));
  });

  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("limits %s discovery to that provider and skips currency queries for empty shop results", async (platform) => {
    expect(await accessibleMarketplaceShops(user, platform)).toEqual([]);
    for (const [name, model] of Object.entries(m.db)) {
      const selected = name.toLowerCase() === `${platform.toLowerCase()}shop`;
      expect(model.findMany).toHaveBeenCalledTimes(selected ? 1 : 0);
    }
  });
});
