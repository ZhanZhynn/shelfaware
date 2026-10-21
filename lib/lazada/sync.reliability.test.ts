import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return { db: { lazadaShop: model(), lazadaProduct: model(), lazadaProductVariant: model(), lazadaOrder: model(), marketplaceFinancialRecord: model(), syncLog: model(), $transaction: vi.fn() }, tx: { lazadaOrder: model(), lazadaOrderItem: model() }, products: vi.fn(), orders: vi.fn(), items: vi.fn(), fees: vi.fn(), token: vi.fn(), fresh: vi.fn(), capability: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ default: m.db }));
vi.mock("./server", () => ({ createLazadaShopContext: (shop: unknown) => shop, ensureFreshLazadaToken: m.fresh, validateLazadaToken: m.token }));
vi.mock("./custom-api", () => ({ getAllProductsCustom: m.products, getAllOrdersCustom: m.orders, getMultipleOrderItemsCustom: m.items, getAllLogisticsFeeDetailCustom: m.fees }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: m.capability }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { isSellerSyncing, syncLazadaAll, syncLazadaLogisticsFees, syncLazadaOrders, syncLazadaProducts } from "./sync";
import { LazadaProviderError } from "./provider-error";

const sourceOrder = (id = 10) => ({ order_id: id, statuses: ["confirmed"], price: "20.00", shipping_fee: "0.00", created_at: "2026-10-01 08:00:00 +0800", updated_at: "2026-10-21 08:00:00 +0800" });
const sourceItem = (id = 100) => ({ order_item_id: id, item_id: 1, sku_id: 2, seller_sku: "BOX-RED", name: "Box", status: "confirmed", item_price: "20.00", paid_price: "18.50", currency: "MYR" });
const product = () => ({ item_id: 1, attributes: { name: "Box" }, primary_category: 10, status: "active", images: ["box.jpg"], skus: [{ SkuId: 2, SellerSku: "BOX-RED", ShopSku: "provider-sku", price: "20.00", special_price: "18.50", quantity: 0, Available: 0 }] });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  m.db.lazadaShop.findFirst.mockResolvedValue({ id: "shop-db", userId: "owner", sellerId: "seller", countryCode: "my" });
  m.db.lazadaProduct.findFirst.mockResolvedValue({ id: "product-db", itemName: "Old", imageUrl: "old.jpg", images: ["old.jpg"] });
  m.db.lazadaProductVariant.findFirst.mockResolvedValue(null);
  m.db.lazadaOrder.findFirst.mockResolvedValue({ id: "order-db" });
  m.tx.lazadaOrder.create.mockResolvedValue({ id: "order-db" });
  m.tx.lazadaOrder.update.mockResolvedValue({ id: "order-db" });
  m.db.$transaction.mockImplementation((work) => work(m.tx));
  m.db.syncLog.create.mockResolvedValue({ id: "log" });
  m.db.syncLog.update.mockResolvedValue({});
  m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue({ id: "fee-db" });
  m.fresh.mockImplementation(async (context: unknown) => context);
  m.token.mockResolvedValue({ valid: true });
  m.products.mockResolvedValue([]);
  m.orders.mockResolvedValue([]);
  m.items.mockResolvedValue([]);
  m.fees.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("Lazada catalog persistence", () => {
  it.each([false, true])("persists the complete supplied product/SKU facts (existing=%s)", async (existing) => {
    m.products.mockResolvedValue([product()]);
    if (!existing) m.db.lazadaProduct.findFirst.mockResolvedValueOnce(null);
    if (existing) m.db.lazadaProductVariant.findFirst.mockResolvedValue({ id: "variant-db" });
    const result = await syncLazadaProducts("seller", "owner", "actor");
    expect(result).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    expect(m.db.lazadaShop.findFirst).toHaveBeenCalledWith({ where: { sellerId: "seller", userId: "owner" } });
    const write = existing ? m.db.lazadaProductVariant.update : m.db.lazadaProductVariant.create;
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sellerSku: "BOX-RED", shopSku: "provider-sku", price: 20, specialPrice: 18.5, stock: 0, available: 0 }) }));
    expect(m.db.syncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "actor", syncType: "products" }) });
  });

  it("preserves an existing title/image if those optional fields are omitted", async () => {
    m.products.mockResolvedValue([{ ...product(), attributes: {}, images: undefined }]);
    await syncLazadaProducts("seller", "owner");
    expect(m.db.lazadaProduct.update).toHaveBeenCalledWith({ where: { id: "product-db" }, data: expect.objectContaining({ itemName: "Old", imageUrl: "old.jpg", images: ["old.jpg"] }) });
  });

  it("continues independent products after a write failure and logs incomplete work", async () => {
    m.products.mockResolvedValue([product(), { ...product(), item_id: 3 }]);
    m.db.lazadaProduct.update.mockRejectedValueOnce(new Error("write failed"));
    const result = await syncLazadaProducts("seller", "owner");
    expect(result).toMatchObject({ synced: 1, errors: ["Product 1: write failed"] });
    expect(m.db.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed_with_errors" }) }));
  });
});

describe("Lazada order response boundaries", () => {
  it("fetches multiple item batches and matches reordered groups by order ID", async () => {
    const orders = Array.from({ length: 51 }, (_, i) => sourceOrder(i + 1));
    m.orders.mockResolvedValue(orders);
    m.items.mockImplementation(async (_context, ids: string[]) => ids.slice().reverse().map((id) => ({ order_id: id, order_items: [sourceItem(Number(id) + 100)] })));
    expect(await syncLazadaOrders("seller", "owner")).toEqual({ synced: 51, created: 0, updated: 51, errors: [] });
    expect(m.items.mock.calls.map((call) => call[1].length)).toEqual([50, 1]);
    expect(m.tx.lazadaOrderItem.create.mock.calls.map(([args]) => args.data.lazadaOrderItemId)).toEqual(orders.map((o) => o.order_id + 100));
  });

  it("does not persist an omitted order group and does not advance successful shop freshness", async () => {
    m.orders.mockResolvedValue([sourceOrder(10), sourceOrder(11)]);
    m.items.mockResolvedValue([{ order_id: 10, order_items: [sourceItem()] }]);
    const result = await syncLazadaOrders("seller", "owner");
    expect(result).toEqual({ synced: 1, created: 0, updated: 1, errors: ["Order 11: ORDER_ITEMS_UNAVAILABLE"] });
    expect(m.db.$transaction).toHaveBeenCalledTimes(1);
    expect(m.db.lazadaShop.update).not.toHaveBeenCalled();
  });

  it.each([null, "malformed", "0.00"])("preserves unknown versus observed zero money: %s", async (amount) => {
    m.orders.mockResolvedValue([{ ...sourceOrder(), price: amount }]);
    m.items.mockResolvedValue([{ order_id: 10, order_items: [{ ...sourceItem(), paid_price: amount }] }]);
    await syncLazadaOrders("seller", "owner");
    const expected = amount === "0.00" ? 0 : null;
    expect(m.tx.lazadaOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: expected, shippingFee: 0 }) }));
    expect(m.tx.lazadaOrderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ quantity: null, paidPrice: expected }) });
  });

  it("keeps disagreeing currencies unknown and honors explicit update-time ranges", async () => {
    m.orders.mockResolvedValue([sourceOrder()]);
    m.items.mockResolvedValue([{ order_id: 10, order_items: [sourceItem(100), { ...sourceItem(101), currency: "SGD" }] }]);
    const range = { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", basis: "updated" as const };
    await syncLazadaOrders("seller", "owner", range);
    expect(m.orders).toHaveBeenCalledWith(expect.anything(), { update_after: range.from, update_before: range.to });
    expect(m.tx.lazadaOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency: null }) }));
  });

  knownGap("KNOWN GAP LAZADA-GROUPS: duplicate response groups must not silently replace the earlier group", async () => {
    m.orders.mockResolvedValue([sourceOrder()]);
    m.items.mockResolvedValue([{ order_id: 10, order_items: [sourceItem(100), sourceItem(101)] }, { order_id: 10, order_items: [sourceItem(100)] }]);
    const result = await syncLazadaOrders("seller", "owner");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(m.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("Lazada logistics source amounts and outcomes", () => {
  it.each([
    { amount: 1.25, minor: "125", scale: 2 }, { amount: { value: "-12.340" }, minor: "-12340", scale: 3 },
    { amount: { amount: "0.00" }, minor: "0", scale: 2 }, { amount: { total: 2 }, minor: "200", scale: 2 },
    { amount: { value: "invalid" }, minor: null, scale: 2 }, { amount: null, minor: null, scale: 2 },
  ])("retains supported logistics amount shapes and unknown values: $amount", async ({ amount, minor, scale }) => {
    m.fees.mockResolvedValue([{ trade_order_id: "10", trade_order_line_id: "100", fee_code: "shipping", fee_name: "Shipping", amount, currency: "MYR", fee_creation_date: "2026-10-01T08:00:00+08:00" }]);
    await syncLazadaLogisticsFees("seller", "owner", "2026-10-01T00:00:00Z");
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "logistics:10:100:shipping", amountMinor: minor, amountScale: scale, amount: null, currency: "MYR", unknownReason: minor === null ? "amount_not_parsed" : null }) }));
  });

  it("reports failed persistence without counting a successful write", async () => {
    m.fees.mockResolvedValue([{ trade_order_id: "10", amount: 1 }]);
    m.db.marketplaceFinancialRecord.upsert.mockRejectedValue(new Error("write failed"));
    expect(await syncLazadaLogisticsFees("seller", "owner")).toMatchObject({ created: 0, updated: 0, errors: ["Logistics fee 10: write failed"] });
  });
});

describe("Lazada real retry and lock boundaries", () => {
  it.each([syncLazadaProducts, syncLazadaOrders, syncLazadaLogisticsFees])("rejects a missing shop before reading its credentials", async (sync) => {
    m.db.lazadaShop.findFirst.mockResolvedValue(null);
    await expect(sync("seller", "owner")).rejects.toThrow("not found");
    expect(m.fresh).not.toHaveBeenCalled();
  });

  it.each([syncLazadaProducts, syncLazadaOrders, syncLazadaLogisticsFees])("fails invalid credentials before provider data access", async (sync) => {
    m.token.mockResolvedValue({ valid: false, error: "expired" });
    await expect(sync("seller", "owner")).rejects.toThrow("expired");
    expect(m.products).not.toHaveBeenCalled();
    expect(m.orders).not.toHaveBeenCalled();
    expect(m.fees).not.toHaveBeenCalled();
  });

  it("retries a structured SellerCallLimit read using the real retry wrapper", async () => {
    m.products.mockRejectedValueOnce(new LazadaProviderError("SellerCallLimit", 429)).mockResolvedValue([]);
    const result = syncLazadaProducts("seller", "owner");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ errors: [] });
    expect(m.products).toHaveBeenCalledTimes(2);
  });

  knownGap("KNOWN GAP LAZADA-RETRY: HTTP 429 must be retried even when the envelope code is not rate-limit text", async () => {
    m.products.mockRejectedValueOnce(new LazadaProviderError("0", 429)).mockResolvedValue([]);
    const result = syncLazadaProducts("seller", "owner").then((value) => value, () => null);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ errors: [] });
    expect(m.products).toHaveBeenCalledTimes(2);
  });

  it("releases a full-sync lock after success and after a rejected stream", async () => {
    await expect(syncLazadaAll("seller", "owner")).resolves.toMatchObject({ products: { errors: [] }, orders: { errors: [] } });
    expect(isSellerSyncing("seller")).toBe(false);
    m.fresh.mockRejectedValue(new Error("refresh failed"));
    await expect(syncLazadaAll("seller", "owner")).rejects.toThrow("refresh failed");
    expect(isSellerSyncing("seller")).toBe(false);
  });
});
