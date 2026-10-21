import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return {
    db: { tikTokShop: model(), tikTokProduct: model(), tikTokProductVariant: model(), tikTokOrder: model(), tikTokOrderItem: model(), marketplaceFinancialRecord: model(), syncLog: model(), $transaction: vi.fn() },
    searchProducts: vi.fn(), getProductDetail: vi.fn(), searchOrders: vi.fn(), getOrderDetail: vi.fn(), getOrderStatementTransactions: vi.fn(), getStatementTransactions: vi.fn(),
    ensureFreshToken: vi.fn(), validateTikTokToken: vi.fn(), getTikTokShopCipher: vi.fn(), capability: vi.fn(),
  };
});
vi.mock("@/prisma/client", () => ({ default: m.db, prisma: m.db }));
vi.mock("./server", () => ({ ensureFreshToken: m.ensureFreshToken, validateTikTokToken: m.validateTikTokToken, getTikTokShopCipher: m.getTikTokShopCipher }));
vi.mock("./custom-api", () => ({ searchProducts: m.searchProducts, getProductDetail: m.getProductDetail, searchOrders: m.searchOrders, getOrderDetail: m.getOrderDetail, getOrderStatementTransactions: m.getOrderStatementTransactions, getStatementTransactions: m.getStatementTransactions }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: m.capability }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { isShopSyncing, syncTikTokAll, syncTikTokFinance, syncTikTokOrders, syncTikTokPayoutStatements, syncTikTokProducts } from "./sync";

const now = new Date("2026-10-21T12:00:00Z");
const sourceLine = { id: "line-1", product_id: "p-1", sku_id: "sku-1", seller_sku: "SELLER-RED", product_name: "Box", original_price: "15.00", sale_price: "12.50", currency: "MYR" };
const sourceOrder = (id = "order-1") => ({ id, status: "COMPLETED", create_time: 1792000000, update_time: 1792100000, payment: { currency: "MYR", total_amount: "12.50" }, line_items: [{ ...sourceLine }] });
const sourceProduct = (id = "p-1") => ({ product_id: id, title: "Box", status: "ACTIVATE", skus: [] });
const collect = async <T>(promise: Promise<T>) => {
  // Attach a handler before advancing timers so expected rejections are never unhandled.
  const outcome = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  m.db.tikTokShop.findFirst.mockResolvedValue({ id: "shop-db" });
  m.db.tikTokProduct.findFirst.mockResolvedValue({ id: "product-db", mainImageUrl: null });
  m.db.tikTokProductVariant.findFirst.mockResolvedValue({ id: "variant-db" });
  m.db.tikTokOrder.findFirst.mockResolvedValue({ id: "order-db" });
  m.db.tikTokOrder.findMany.mockResolvedValue([{ tiktokOrderId: "order-1" }]);
  m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
  m.db.marketplaceFinancialRecord.findMany.mockResolvedValue([]);
  m.db.syncLog.create.mockResolvedValue({ id: "log" });
  m.db.syncLog.update.mockResolvedValue({});
  m.ensureFreshToken.mockResolvedValue("token");
  m.validateTikTokToken.mockResolvedValue({ valid: true });
  m.getTikTokShopCipher.mockResolvedValue("cipher");
  m.searchProducts.mockResolvedValue({ products: [], next_page_token: "" });
  m.getProductDetail.mockResolvedValue({ skus: [] });
  m.searchOrders.mockResolvedValue({ orders: [], next_page_token: "" });
  m.getOrderDetail.mockResolvedValue({ orders: [] });
  m.getOrderStatementTransactions.mockResolvedValue({ order_id: "order-1", currency: "MYR", settlement_amount: "1.25" });
});
afterEach(() => vi.useRealTimers());

describe("TikTok non-empty order ingestion", () => {
  it.each([false, true])("persists an owned order and its source line (existing=%s)", async (existing) => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }] });
    m.getOrderDetail.mockResolvedValue({ orders: [sourceOrder()] });
    if (!existing) m.db.tikTokOrder.findFirst.mockResolvedValueOnce(null);
    const result = await syncTikTokOrders("provider-shop", "owner", { from: 100, to: 200 }, "actor");
    expect(result).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    const write = existing ? m.db.tikTokOrder.update : m.db.tikTokOrder.create;
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: "delivered", currency: "MYR", tiktokCreatedAt: new Date(1792000000000) }) }));
    expect(m.db.tikTokOrder.findFirst).toHaveBeenCalledWith({ where: { shopId: "shop-db", tiktokOrderId: "order-1" } });
    expect(m.db.tikTokOrderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orderId: "order-db", shopId: "shop-db", variantId: "variant-db", tiktokOrderLineItemId: "line-1", sellerSku: "SELLER-RED", price: 12.5, originalPrice: 15, quantity: null, subtotalAmount: null }) });
    expect(m.db.syncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "actor", shopId: "shop-db", channel: "tiktok" }) });
    expect(m.ensureFreshToken.mock.invocationCallOrder[0]).toBeLessThan(m.validateTikTokToken.mock.invocationCallOrder[0]!);
  });

  it("exhausts search pages and details batches of 50 before counting all returned orders", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `order-${i}`);
    m.searchOrders.mockResolvedValueOnce({ orders: ids.slice(0, 50).map((id) => ({ id })), next_page_token: "page-2" }).mockResolvedValueOnce({ orders: [{ id: ids[50] }] });
    m.getOrderDetail.mockImplementation(async (_token, _cipher, batch: string[]) => ({ orders: batch.slice().reverse().map((id) => ({ ...sourceOrder(id), line_items: [] })) }));
    const result = await syncTikTokOrders("provider-shop", "owner", { from: 100, to: 200 });
    expect(result.synced).toBe(51);
    expect(m.searchOrders.mock.calls[1]?.[4]).toBe("page-2");
    expect(m.getOrderDetail.mock.calls.map((call) => call[2].length)).toEqual([50, 1]);
    expect(m.db.tikTokOrder.update).toHaveBeenCalledTimes(51);
  });

  it.each([["UNPAID", "pending"], ["ON_HOLD", "confirmed"], ["AWAITING_SHIPMENT", "confirmed"], ["PARTIALLY_SHIPPING", "processing"], ["AWAITING_COLLECTION", "processing"], ["IN_TRANSIT", "shipped"], ["DELIVERED", "delivered"], ["CANCELLED", "cancelled"]])("normalizes %s as %s", async (status, expected) => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }] });
    m.getOrderDetail.mockResolvedValue({ orders: [{ ...sourceOrder(), status }] });
    await syncTikTokOrders("provider-shop", "owner");
    expect(m.db.tikTokOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: expected }) }));
  });

  it("reports an item-write failure and continues with independent orders", async () => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "bad" }, { id: "good" }] });
    m.getOrderDetail.mockResolvedValue({ orders: [sourceOrder("bad"), sourceOrder("good")] });
    m.db.tikTokOrderItem.create.mockRejectedValueOnce(new Error("item write failed"));
    const result = await syncTikTokOrders("provider-shop", "owner");
    expect(result.synced).toBe(1);
    expect(result.errors).toEqual(["Order bad: item write failed"]);
    expect(m.db.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed_with_errors", itemsSynced: 1 }) }));
  });

  it("reports a rejected detail batch rather than counting its orders", async () => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }] });
    m.getOrderDetail.mockRejectedValue(new Error("provider unavailable"));
    const result = await syncTikTokOrders("provider-shop", "owner");
    expect(result.synced).toBe(0);
    expect(result.errors).toEqual([expect.stringContaining("provider unavailable")]);
    expect(m.db.tikTokOrder.update).not.toHaveBeenCalled();
  });

  knownGap("KNOWN GAP TIKTOK-DETAILS: a silently omitted detail ID must make the result incomplete", async () => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }, { id: "missing" }] });
    m.getOrderDetail.mockResolvedValue({ orders: [sourceOrder()] });
    const result = await syncTikTokOrders("provider-shop", "owner");
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("missing")]));
  });

  knownGap("KNOWN GAP TIKTOK-FRESHNESS: partial persistence must not advance successful shop freshness", async () => {
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }] });
    m.getOrderDetail.mockRejectedValue(new Error("provider unavailable"));
    const result = await syncTikTokOrders("provider-shop", "owner");
    expect(result.errors).toHaveLength(1);
    expect(m.db.tikTokShop.update).not.toHaveBeenCalled();
  });

  knownGap("KNOWN GAP TIKTOK-ATOMICITY: a failed replacement must preserve the previous item set", async () => {
    let stored = ["previous-line"];
    // Stateful unit boundary, not a claim of testing MongoDB transaction semantics.
    m.db.$transaction.mockImplementation(async (work) => {
      const before = [...stored];
      try { return await work(m.db); } catch (error) { stored = before; throw error; }
    });
    m.db.tikTokOrderItem.deleteMany.mockImplementation(async () => { stored = []; return { count: 1 }; });
    m.db.tikTokOrderItem.create.mockRejectedValue(new Error("item write failed"));
    m.searchOrders.mockResolvedValue({ orders: [{ id: "order-1" }] });
    m.getOrderDetail.mockResolvedValue({ orders: [sourceOrder()] });
    const result = await syncTikTokOrders("provider-shop", "owner");
    expect(result.errors).toEqual(["Order order-1: item write failed"]);
    expect(stored).toEqual(["previous-line"]);
  });
});

describe("TikTok products and SKU formats", () => {
  it.each([
    { sku: { id: "sku", sku_price: { price: "12.50", original_price: "15.00", currency: "MYR" }, inventory: 7 }, price: 12.5, originalPrice: 15, stock: 7 },
    { sku: { id: "sku", price: { sale_price: "9.25", currency: "MYR" }, inventory: [{ quantity: 3 }, { available_stock: 4 }] }, price: 9.25, originalPrice: null, stock: 7 },
    { sku: { id: "sku", price: "8.00", currency: "MYR", inventory: { total_quantity: 2 } }, price: 8, originalPrice: null, stock: 2 },
    { sku: { id: "sku", price: { tax_exclusive_price: "0.00", currency: "MYR" }, inventory: 0 }, price: 0, originalPrice: null, stock: 0 },
  ])("normalizes a complete detail SKU without manufacturing unit sales: $sku", async ({ sku, price, originalPrice, stock }) => {
    m.searchProducts.mockResolvedValue({ products: [sourceProduct()] });
    m.getProductDetail.mockResolvedValue({ skus: [{ ...sku, seller_sku: "SELLER-SKU", sales_attributes: [{ name: "Color", value_name: "Red" }] }], main_images: [{ thumb_urls: ["https://example.test/box.jpg"] }] });
    const result = await collect(syncTikTokProducts("provider-shop", "owner", "actor"));
    expect(result).toEqual({ value: { synced: 1, created: 0, updated: 1, errors: [] } });
    expect(m.db.tikTokProductVariant.update).toHaveBeenCalledWith({ where: { id: "variant-db" }, data: expect.objectContaining({ sellerSku: "SELLER-SKU", price, originalPrice, currency: "MYR", totalQuantity: stock, updatedBy: "actor", salesAttrs: [{ name: "Color", value_name: "Red" }] }) });
    expect(m.db.tikTokProduct.update).toHaveBeenCalledWith({ where: { id: "product-db" }, data: { mainImageUrl: "https://example.test/box.jpg", updatedBy: "actor" } });
  });

  it("creates products and variants with owned identities across paginated search results", async () => {
    m.searchProducts.mockResolvedValueOnce({ products: [{ ...sourceProduct(), skus: [{ id: "sku-1", price: "1.00" }] }], next_page_token: "next" }).mockResolvedValueOnce({ products: [sourceProduct("p-2")] });
    m.db.tikTokProduct.findFirst.mockResolvedValueOnce(null);
    m.db.tikTokProductVariant.findFirst.mockResolvedValue(null);
    await syncTikTokProducts("provider-shop", "owner", "actor");
    expect(m.searchProducts).toHaveBeenNthCalledWith(2, "token", "cipher", {}, 50, "next");
    expect(m.db.tikTokProduct.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tiktokProductId: "p-1", shopId: "shop-db", userId: "owner", createdBy: "actor", status: "active" }) });
    expect(m.db.tikTokProductVariant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tiktokSkuId: "sku-1", productId: "product-db", shopId: "shop-db", userId: "owner", createdBy: "actor" }) });
  });

  it("keeps a search image when a detail image is available and reports detail failure", async () => {
    m.searchProducts.mockResolvedValue({ products: [sourceProduct(), sourceProduct("p-2")] });
    m.db.tikTokProduct.findFirst.mockResolvedValue({ id: "product-db", mainImageUrl: "known.jpg" });
    m.getProductDetail.mockResolvedValueOnce({ skus: [{ id: "sku", price: "1" }], main_images: [{ urls: ["new.jpg"] }] }).mockRejectedValueOnce(new Error("detail unavailable"));
    const outcome = await collect(syncTikTokProducts("provider-shop", "owner"));
    expect(outcome).toMatchObject({ value: { synced: 2, errors: ["Product detail p-2: detail unavailable"] } });
    expect(m.db.tikTokProduct.update.mock.calls.some(([args]) => args.data.mainImageUrl === "new.jpg")).toBe(false);
  });

  knownGap("KNOWN GAP TIKTOK-SKU: an unavailable price must not overwrite a known price with zero", async () => {
    m.searchProducts.mockResolvedValue({ products: [sourceProduct()] });
    m.getProductDetail.mockResolvedValue({ skus: [{ id: "sku", price: "malformed" }] });
    await collect(syncTikTokProducts("provider-shop", "owner"));
    const writes = m.db.tikTokProductVariant.update.mock.calls.map(([args]) => args.data);
    expect(writes).toHaveLength(1);
    expect(writes[0].price).not.toBe(0);
  });
});

describe("TikTok finance failure and numeric boundaries", () => {
  it.each([
    { amount: "0", minor: "0", scale: 0 }, { amount: "-0012.340", minor: "-12340", scale: 3 },
    { amount: "9007199254740993.01", minor: "900719925474099301", scale: 2 },
    { amount: "invalid", minor: null, scale: 2 }, { amount: null, minor: null, scale: 2 }, { amount: 1.25, minor: null, scale: 2 },
  ])("retains exact source precision and rejects invented precision for $amount", async ({ amount, minor, scale }) => {
    m.getOrderStatementTransactions.mockResolvedValue({ currency: "MYR", order_create_time: 1700000000, sku_transactions: [{ sku_id: "sku", settlement_amount: amount }] });
    const result = await syncTikTokFinance("provider-shop", "owner");
    expect(result).toMatchObject({ synced: 1, created: 1, errors: [] });
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "order-1:sku:0", amountMinor: minor, amountScale: scale, amount: null, occurredAt: new Date(1700000000000) }) }));
  });

  it("counts updates and isolates an unavailable statement without dropping successful orders", async () => {
    m.db.tikTokOrder.findMany.mockResolvedValue([{ tiktokOrderId: "bad" }, { tiktokOrderId: "good" }]);
    m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue({ id: "existing" });
    m.getOrderStatementTransactions.mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce({ order_id: "good", settlement_amount: "1.00" });
    expect(await syncTikTokFinance("provider-shop", "owner")).toMatchObject({ synced: 1, updated: 1, created: 0, errors: ["Order bad: denied"] });
  });

  it("marks finance failed when every provider request fails, preserving the original error", async () => {
    m.getOrderStatementTransactions.mockRejectedValue(new Error("denied"));
    await expect(syncTikTokFinance("provider-shop", "owner")).rejects.toThrow("denied");
    expect(m.capability).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", capability: "finance" }));
    expect(m.db.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  });

  it("does not claim finance availability when no orders were observed", async () => {
    m.db.tikTokOrder.findMany.mockResolvedValue([]);
    expect(await syncTikTokFinance("provider-shop", "owner")).toMatchObject({ synced: 0, errors: [] });
    expect(m.capability).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown" }));
    expect(m.getOrderStatementTransactions).not.toHaveBeenCalled();
  });

  it("reports payout persistence failure without claiming settlement capability", async () => {
    m.db.marketplaceFinancialRecord.findMany.mockResolvedValue([{ statementExternalId: "statement" }]);
    m.getStatementTransactions.mockResolvedValue({ id: "statement", status: "SETTLED", payable_amount: "0.00", currency: "MYR", create_time: 1700000000 });
    m.db.marketplaceFinancialRecord.upsert.mockRejectedValue(new Error("write failed"));
    expect(await syncTikTokPayoutStatements("provider-shop", "owner")).toMatchObject({ synced: 0, errors: ["Statement statement: write failed"] });
    expect(m.capability).not.toHaveBeenCalled();
  });
});

describe("TikTok ownership, retries and full-sync lock lifecycle", () => {
  it.each([syncTikTokProducts, syncTikTokOrders, syncTikTokFinance, syncTikTokPayoutStatements])("rejects a missing owned shop before provider access", async (sync) => {
    m.db.tikTokShop.findFirst.mockResolvedValue(null);
    await expect(sync("provider-shop", "owner")).rejects.toThrow("not found");
    expect(m.ensureFreshToken).not.toHaveBeenCalled();
  });

  it.each([syncTikTokProducts, syncTikTokOrders, syncTikTokFinance, syncTikTokPayoutStatements])("rejects an invalid token before reading provider data", async (sync) => {
    m.validateTikTokToken.mockResolvedValue({ valid: false, error: "expired" });
    await expect(sync("provider-shop", "owner")).rejects.toThrow("expired");
    expect(m.searchOrders).not.toHaveBeenCalled();
    expect(m.searchProducts).not.toHaveBeenCalled();
  });

  it("executes the actual retry wrapper for a throttled order read", async () => {
    m.searchOrders.mockRejectedValueOnce(new Error("429")).mockResolvedValue({ orders: [] });
    const result = await collect(syncTikTokOrders("provider-shop", "owner"));
    expect(result).toMatchObject({ value: { synced: 0, errors: [] } });
    expect(m.searchOrders).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent full syncs for the same shop and releases the lock on failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    m.ensureFreshToken.mockImplementation(async () => { await gate; throw new Error("refresh failed"); });
    const running = syncTikTokAll("provider-shop", "owner");
    const failure = expect(running).rejects.toThrow("refresh failed");
    expect(isShopSyncing("provider-shop")).toBe(true);
    await expect(syncTikTokAll("provider-shop", "owner")).rejects.toThrow("already in progress");
    release();
    await failure;
    expect(isShopSyncing("provider-shop")).toBe(false);
  });

  it("releases a successful full-sync lock and returns both stream results", async () => {
    await expect(syncTikTokAll("provider-shop", "owner")).resolves.toMatchObject({ products: { errors: [] }, orders: { errors: [] } });
    expect(isShopSyncing("provider-shop")).toBe(false);
  });
});
