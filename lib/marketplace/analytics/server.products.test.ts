import { beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => {
  const findMany = () => ({ findMany: vi.fn() });
  return { db: { shopeeShop: findMany(), shopeeOrder: findMany(), lazadaShop: findMany(), lazadaOrder: findMany(), lazadaProduct: findMany(), tikTokShop: findMany(), tikTokOrder: findMany(), shopifyShop: findMany(), shopifyOrder: findMany(), shopifyProductVariant: findMany() }, cache: vi.fn(), setCache: vi.fn(), capabilities: vi.fn(), readiness: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ prisma: m.db }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: async () => ["owner"], marketplaceCacheScope: () => "owner" }));
vi.mock("@/lib/marketplace/shops", () => ({ accessibleMarketplaceShops: async () => [{ id: "shop", region: "MY", lastSyncedAt: "2026-10-21T00:00:00Z" }] }));
vi.mock("@/lib/cache/cache-utils", () => ({ getCache: m.cache, setCache: m.setCache }));
vi.mock("./capabilities", () => ({ getMarketplaceCapabilities: m.capabilities, getMarketplaceFinancialReadiness: m.readiness }));
import { getMarketplaceAnalytics } from "./server";
import type { MarketplacePlatform } from "./types";

const user = { id: "owner", role: "admin" };
const baseOrder = { id: "order", shopId: "shop", currency: "MYR", orderStatus: "COMPLETED", createdAt: new Date("2026-10-15T00:00:00Z"), sourceObservedAt: new Date("2026-10-21T00:00:00Z"), totalAmount: 25, subtotalAmount: 25, financialQuality: "unknown", payment: { currency: "MYR", total_product_price: 25 } };
const item = (sku: string, quantity: number | null, subtotal = 10) => ({ id: `line-${sku}`, productName: "Box", name: "Box", sku, sellerSku: sku, productId: `product-${sku}`, variantId: `variant-${sku}`, skuId: `variant-${sku}`, itemId: 1, tiktokOrderLineItemId: `line-${sku}`, quantity, currentQuantity: quantity, price: 12.5, discountedPrice: 10, paidPrice: subtotal, subtotal, subtotalAmount: subtotal });
const sourceFields = { shopee: "shopeeCreatedAt", lazada: "lazadaCreatedAt", tiktok: "tiktokCreatedAt", shopify: "shopifyCreatedAt" } as const;
const queryFor = (platform: MarketplacePlatform) => ({ shopee: m.db.shopeeOrder, lazada: m.db.lazadaOrder, tiktok: m.db.tikTokOrder, shopify: m.db.shopifyOrder })[platform].findMany;

beforeEach(() => {
  vi.resetAllMocks();
  for (const model of Object.values(m.db)) model.findMany.mockResolvedValue([]);
  for (const shop of [m.db.shopeeShop, m.db.lazadaShop, m.db.tikTokShop, m.db.shopifyShop]) shop.findMany.mockResolvedValue([{ id: "shop" }]);
  m.cache.mockResolvedValue(null);
  m.capabilities.mockResolvedValue({ orders: "available", finance: "unknown" });
  m.readiness.mockResolvedValue(false);
});

describe("cross-platform SKU analytics from actual normalized order rows", () => {
  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("aggregates %s lines by stable variant identity and excludes cancelled/failed orders", async (platform) => {
    const field = sourceFields[platform];
    queryFor(platform).mockResolvedValue([
      { ...baseOrder, [field]: baseOrder.createdAt, items: [item("RED", 2, 20), item("BLUE", 1, 10)] },
      { ...baseOrder, id: "second", [field]: baseOrder.createdAt, items: [item("RED", 1, 10)] },
      { ...baseOrder, id: "cancelled", orderStatus: "cancelled", [field]: baseOrder.createdAt, items: [item("CANCELLED", 100, 1000)] },
      { ...baseOrder, id: "failed", orderStatus: "FAILED", [field]: baseOrder.createdAt, items: [item("FAILED", 100, 1000)] },
    ]);
    const result = await getMarketplaceAnalytics(platform, user, new URLSearchParams({ shopId: "shop", limit: "100" }), "products");
    expect(result.products.map((row) => ({ sku: row.sku, quantity: row.quantity, sales: row.operationalSales }))).toEqual([{ sku: "RED", quantity: 3, sales: 30 }, { sku: "BLUE", quantity: 1, sales: 10 }]);
    expect(result.summary).toMatchObject({ totalOrders: 4, operationalOrderCount: 2 });
    expect(result.operationalCoverage.rawItemCount).toBe(5);
    if (platform === "shopify") expect(queryFor(platform).mock.calls[0]![0].where.test).toBe(false);
  });

  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("uses the exact %s source date scope for both week-over-week cohorts", async (platform) => {
    for (const [from, to] of [["2026-10-07T00:00:00+08:00", "2026-10-13T23:59:59+08:00"], ["2026-10-14T00:00:00+08:00", "2026-10-20T23:59:59+08:00"]]) {
      await getMarketplaceAnalytics(platform, user, new URLSearchParams({ shopId: "shop", dateFrom: from!, dateTo: to! }), "products");
      expect(queryFor(platform)).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ [sourceFields[platform]]: { gte: new Date(from!), lte: new Date(to!) } }, { [sourceFields[platform]]: null, createdAt: { gte: new Date(from!), lte: new Date(to!) } }] }) }));
    }
  });

  it.each(["shopee", "lazada", "tiktok"] as const)("does not substitute item-row count for an unknown %s unit quantity", async (platform) => {
    queryFor(platform).mockResolvedValue([{ ...baseOrder, items: [item("RED", null, 10), item("RED", 2, 20)] }]);
    const result = await getMarketplaceAnalytics(platform, user, new URLSearchParams(), "products");
    expect(result.products).toMatchObject([{ sku: "RED", quantity: null, operationalSales: 30 }]);
    expect(result.operationalCoverage).toMatchObject({ state: "partial", unknownQuantityCount: 1, rawItemCount: 2 });
  });

  it("uses Shopify current quantities and discounted unit prices without calling them refunds", async () => {
    m.db.shopifyOrder.findMany.mockResolvedValue([{ ...baseOrder, items: [{ ...item("RED", 3), currentQuantity: 1 }] }]);
    const result = await getMarketplaceAnalytics("shopify", user, new URLSearchParams(), "products");
    expect(result.products).toMatchObject([{ quantity: 1, operationalSales: 10 }]);
    expect(result.summary.netSales).toBeNull();
  });

  it("paginates the full aggregation, preserving totals when the requested page size changes", async () => {
    m.db.shopeeOrder.findMany.mockResolvedValue([{ ...baseOrder, items: [item("A", 1, 30), item("B", 1, 20), item("C", 1, 10)] }]);
    const first = await getMarketplaceAnalytics("shopee", user, new URLSearchParams({ limit: "1" }), "products");
    expect(first.products.map((row) => row.sku)).toEqual(["A"]);
    expect(first.page).toMatchObject({ total: 3, limit: 1 });
    const second = await getMarketplaceAnalytics("shopee", user, new URLSearchParams({ limit: "2", cursor: first.page!.nextCursor! }), "products");
    expect(second.products.map((row) => row.sku)).toEqual(["B", "C"]);
    expect(second.page).toMatchObject({ total: 3, nextCursor: null });
  });

  it.each(["shopee", "lazada", "tiktok", "shopify"] as const)("builds UTC day/week/month trend buckets for %s", async (platform) => {
    queryFor(platform).mockResolvedValue([{ ...baseOrder, [sourceFields[platform]]: new Date("2026-10-15T00:00:00Z"), items: [] }]);
    for (const [granularity, date] of [["day", "2026-10-15"], ["week", "2026-10-12"], ["month", "2026-10"]]) {
      const result = await getMarketplaceAnalytics(platform, user, new URLSearchParams({ granularity: granularity! }), "revenue-trend");
      expect(result.revenueTrend).toEqual([{ date, operationalSales: 25, grossSales: null, netSales: null, estimatedProfit: null, orders: 1 }]);
    }
  });

  knownGap("KNOWN GAP SHOPIFY-COVERAGE: a first-seen incomplete order with zero stored items cannot be ready", async () => {
    m.db.shopifyOrder.findMany.mockResolvedValue([{ ...baseOrder, isLineItemsComplete: false, items: [] }]);
    const result = await getMarketplaceAnalytics("shopify", user, new URLSearchParams(), "products");
    expect(result.operationalCoverage.state).toBe("partial");
  });
});
