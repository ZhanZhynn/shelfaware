import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn() });
  return { db: { shopeeShop: model(), shopeeOrder: model(), shopeeProduct: model(), lazadaShop: model(), lazadaOrder: model(), lazadaProduct: model(), tikTokShop: model(), tikTokOrder: model(), tikTokProduct: model(), shopifyShop: model(), shopifyOrder: model(), shopifyProduct: model() } };
});
vi.mock("@/prisma/client", () => ({ prisma: m.db }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: async () => ["owner"] }));
import { getMarketplaceOrder, getMarketplaceProduct, listMarketplaceOrders, listMarketplaceProducts, MarketplaceV1NotFoundError, parseLocalQuery } from "./local-catalog";

const id = "a".repeat(24), shopId = "b".repeat(24), user = { id: "actor", role: "admin" };
const models = { shopee: { shop: m.db.shopeeShop, order: m.db.shopeeOrder, product: m.db.shopeeProduct }, lazada: { shop: m.db.lazadaShop, order: m.db.lazadaOrder, product: m.db.lazadaProduct }, tiktok: { shop: m.db.tikTokShop, order: m.db.tikTokOrder, product: m.db.tikTokProduct }, shopify: { shop: m.db.shopifyShop, order: m.db.shopifyOrder, product: m.db.shopifyProduct } };
const row = { id, shopId, shopeeOrderId: "order", lazadaOrderId: "order", tiktokOrderId: "order", shopifyOrderId: "order", shopeeItemId: 1, lazadaItemId: 1, tiktokProductId: "product", shopifyProductId: "product", orderStatus: "COMPLETED", itemName: "Box", title: "Box", currency: "MYR", totalAmount: 0, subtotalAmount: 0, shippingFee: 0, stock: 0, totalInventory: 0, createdAt: new Date("2026-10-01T00:00:00Z"), items: [], variants: [] };
beforeEach(() => {
  vi.resetAllMocks();
  for (const model of Object.values(m.db)) { model.findFirst.mockResolvedValue(row); model.findMany.mockResolvedValue([row]); }
  for (const model of Object.values(models)) model.shop.findFirst.mockResolvedValue({ id: shopId });
});

describe.each(["shopee", "lazada", "tiktok", "shopify"] as const)("%s local catalog isolation", (platform) => {
  it("normalizes populated order lists without treating a missing amount as zero", async () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId, limit: "1", dateBasis: "source", createdAfter: "2026-10-01T00:00:00Z" }), "orders");
    const result = await listMarketplaceOrders(platform, user, query);
    expect(result.data).toMatchObject([{ id, shopId, externalId: "order", totalAmount: platform === "tiktok" ? null : 0 }]);
    expect(result).toMatchObject({ page: { nextCursor: null }, filters: { dateBasis: "source", sourceTimestampFallback: "ingested_when_source_missing" } });
    expect(models[platform].order.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, where: expect.objectContaining({ userId: { in: ["owner"] }, shopId }) }));
  });

  it("scopes product search to authorized shop/owner and paginates without duplicating rows", async () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId, limit: "1", search: "BOX" }), "products");
    models[platform].product.findMany.mockResolvedValue([row, { ...row, id: "c".repeat(24) }]);
    const first = await listMarketplaceProducts(platform, user, query);
    expect(first.data).toHaveLength(1);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(models[platform].product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { in: ["owner"] }, shopId, OR: expect.any(Array) }), take: 2 }));
    await listMarketplaceProducts(platform, user, { ...query, cursor: first.page.nextCursor! });
    expect(models[platform].product.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id }, skip: 1 }));
  });

  it("exposes order/product details only through owned canonical IDs", async () => {
    expect(await getMarketplaceOrder(platform, user, id)).toMatchObject({ id, shopId, externalId: "order", totalAmount: platform === "tiktok" ? null : 0 });
    expect(await getMarketplaceProduct(platform, user, id)).toMatchObject({ id, shopId, variants: [] });
    for (const model of [models[platform].order, models[platform].product]) expect(model.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, userId: { in: ["owner"] } } }));
  });

  it("rejects a missing shop before reading local collections", async () => {
    models[platform].shop.findFirst.mockResolvedValue(null);
    models[platform].order.findMany.mockClear();
    await expect(listMarketplaceOrders(platform, user, { shopId, limit: 50 })).rejects.toBeInstanceOf(MarketplaceV1NotFoundError);
    expect(models[platform].order.findMany).not.toHaveBeenCalled();
  });

  it("returns not-found for unavailable order and product records", async () => {
    models[platform].order.findFirst.mockResolvedValue(null);
    models[platform].product.findFirst.mockResolvedValue(null);
    await expect(getMarketplaceOrder(platform, user, id)).rejects.toThrow("Order not found");
    await expect(getMarketplaceProduct(platform, user, id)).rejects.toThrow("Product not found");
  });

  it("preserves external variant identities and explicit zero prices/stocks", async () => {
    models[platform].product.findFirst.mockResolvedValue({ ...row, variants: [{ id: "variant", modelId: 2, skuId: 2, tiktokSkuId: "2", shopifyVariantId: "2", modelSku: "BOX", sellerSku: "BOX", sku: "BOX", modelName: "Red", variation: "Red", title: "Red", price: 0, stock: 0, totalQuantity: 0, inventoryQuantity: 0 }] });
    expect(await getMarketplaceProduct(platform, user, id)).toMatchObject({ variants: [{ externalId: "2", sku: "BOX", price: 0, stock: 0 }] });
  });
});

describe("local source line semantics", () => {
  it("does not infer Lazada unit quantity from a paid-price line", async () => {
    m.db.lazadaOrder.findFirst.mockResolvedValue({ ...row, items: [{ id: "line", lazadaOrderItemId: 100, itemId: 1, skuId: "sku", sellerSku: "BOX", productName: "Box", quantity: null, price: 20, paidPrice: 18, currency: "MYR" }] });
    expect(await getMarketplaceOrder("lazada", user, id)).toMatchObject({ unitQuantity: null, lineItems: [{ externalLineId: "100", sku: "BOX", quantity: null, subtotal: 18 }] });
  });

  it("exposes selected numeric TikTok payment facts without returning the raw payment object", async () => {
    m.db.tikTokOrder.findFirst.mockResolvedValue({ ...row, payment: { total_amount: 12.5, total_product_price: 10, total_shipping_fee: "2.50", private: "sensitive" }, items: [{ id: "line", tiktokOrderLineItemId: "external-line", productId: "p", skuId: "sku", sellerSku: "BOX", quantity: null, price: 10, currency: "MYR" }] });
    const result = await getMarketplaceOrder("tiktok", user, id);
    expect(result).toMatchObject({ totalAmount: 12.5, subtotalAmount: 10, shippingAmount: null, lineItems: [{ externalLineId: "external-line", sku: "BOX", quantity: null }] });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });

  it("keeps Shopify stored ordered quantity and decimal line total distinct from current quantity", async () => {
    m.db.shopifyOrder.findFirst.mockResolvedValue({ ...row, items: [{ id: "line", shopifyLineId: "gid://shopify/LineItem/1", quantity: 3, currentQuantity: 1, price: 12.5, discountedPrice: 10, discountedLineAmount: "3000", discountedLineScale: 2, originalUnitPriceAmount: "1250", originalUnitPriceScale: 2, sku: "BOX", currency: "MYR" }] });
    expect(await getMarketplaceOrder("shopify", user, id)).toMatchObject({ lineItems: [{ quantity: 3, subtotal: 30, originalUnitPrice: 12.5, unitPrice: 10, discountAmount: 7.5 }] });
  });
});
