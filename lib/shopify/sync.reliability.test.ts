import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() });
  const tx = { shopifyOrder: model(), shopifyOrderItem: model(), shopifyProductVariant: model() };
  return { db: { shopifyShop: model(), shopifyProduct: model(), shopifyProductVariant: model(), shopifyOrder: model(), marketplaceFinancialRecord: model(), syncLog: model(), $transaction: vi.fn() }, tx, products: vi.fn(), orders: vi.fn(), finance: vi.fn(), token: vi.fn(), capability: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ default: m.db }));
vi.mock("./graphql-client", () => ({ fetchAllProducts: m.products, fetchAllOrders: m.orders, fetchAllFinanceOrders: m.finance }));
vi.mock("./server", () => ({ validateShopifyToken: m.token, SHOPIFY_API_VERSION: "2025-07" }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: m.capability }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { isShopSyncing, syncShopifyAll, syncShopifyFinance, syncShopifyOrders, syncShopifyProducts } from "./sync";
import { ShopifyProviderError } from "./provider-error";

const now = new Date("2026-10-21T12:00:00Z");
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "MYR" } });
const line = { id: "gid://shopify/LineItem/1", name: "Box", title: "Box", quantity: 3, currentQuantity: 2, unfulfilledQuantity: 1, sku: "BOX-RED", product: { id: "gid://shopify/Product/1" }, variant: { id: "gid://shopify/ProductVariant/2" }, originalUnitPriceSet: money("12.50"), discountedUnitPriceSet: money("10.00"), discountedTotalSet: money("30.00") };
const order = () => ({ id: "gid://shopify/Order/1", name: "#1", closed: false, cancelledAt: null, test: false, confirmed: true, currencyCode: "MYR", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", processedAt: "2026-10-01T00:00:00Z", totalPriceSet: money("30.00"), subtotalPriceSet: money("30.00"), totalShippingPriceSet: money("0.00"), totalTaxSet: money("0.00"), lineItems: { nodes: [line], pageInfo: { hasNextPage: false, endCursor: null } } });
const variant = { id: "gid://shopify/ProductVariant/2", title: "Red", sku: "BOX-RED", price: "12.50", compareAtPrice: "15.00", inventoryQuantity: 0, availableForSale: true };
const product = () => ({ id: "gid://shopify/Product/1", title: "Box", status: "ACTIVE", currencyCode: "MYR", totalInventory: 0, tracksInventory: true, featuredImage: { url: "box.jpg" }, variants: { nodes: [variant] } });
const transaction = (id: string, amount = "12.50") => ({ id, kind: "SALE", status: "SUCCESS", gateway: "test", createdAt: "2026-10-01T00:00:00Z", processedAt: null, amountSet: money(amount) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  m.db.shopifyShop.findFirst.mockResolvedValue({ id: "shop-db", shopDomain: "shop.myshopify.com", accessToken: "token" });
  m.db.syncLog.create.mockResolvedValue({ id: "log" });
  m.db.syncLog.update.mockResolvedValue({});
  m.db.shopifyProduct.findFirst.mockResolvedValue(null);
  m.db.shopifyProduct.create.mockResolvedValue({ id: "product-db" });
  m.db.shopifyProduct.update.mockResolvedValue({ id: "product-db" });
  m.db.shopifyProductVariant.findFirst.mockResolvedValue(null);
  m.db.shopifyOrder.findFirst.mockResolvedValue({ id: "order-db", isLineItemsComplete: true, items: [] });
  m.tx.shopifyOrder.update.mockResolvedValue({ id: "order-db" });
  m.tx.shopifyOrder.create.mockResolvedValue({ id: "order-db" });
  m.tx.shopifyProductVariant.findFirst.mockResolvedValue({ id: "variant-db" });
  m.db.$transaction.mockImplementation((work) => work(m.tx));
  m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
  m.token.mockResolvedValue({ valid: true });
  m.products.mockResolvedValue([]);
  m.orders.mockResolvedValue([]);
  m.finance.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("Shopify complete catalog persistence", () => {
  it.each([false, true])("persists the product and every supplied variant (existing=%s)", async (existing) => {
    m.products.mockResolvedValue([product()]);
    if (existing) {
      m.db.shopifyProduct.findFirst.mockResolvedValue({ id: "product-db" });
      m.db.shopifyProductVariant.findFirst.mockResolvedValue({ id: "variant-db" });
    }
    expect(await syncShopifyProducts("shop-db", "owner", "actor")).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    expect(m.db.shopifyShop.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop-db", userId: "owner" } }));
    expect(m.products).toHaveBeenCalledWith("shop.myshopify.com", "token");
    const write = existing ? m.db.shopifyProductVariant.update : m.db.shopifyProductVariant.create;
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productId: "product-db", shopifyVariantId: variant.id, sku: "BOX-RED", price: 12.5, compareAtPrice: 15, inventoryQuantity: 0, currency: "MYR" }) }));
    expect(m.db.syncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "actor", channel: "shopify", syncType: "products" }) });
  });

  it("continues independent products after a product write fails", async () => {
    m.products.mockResolvedValue([product(), { ...product(), id: "gid://shopify/Product/3" }]);
    m.db.shopifyProduct.create.mockRejectedValueOnce(new Error("write failed"));
    const result = await syncShopifyProducts("shop-db", "owner");
    expect(result.synced).toBe(1);
    expect(result.errors).toEqual(["Product gid://shopify/Product/1: write failed"]);
    expect(m.db.shopifyProductVariant.create).toHaveBeenCalledTimes(1);
  });
});

describe("Shopify order facts and transaction boundary", () => {
  it.each([false, true])("keeps source IDs, separate ordered/current quantities and both price bases (existing=%s)", async (existing) => {
    m.orders.mockResolvedValue([order()]);
    if (!existing) m.db.shopifyOrder.findFirst.mockResolvedValue(null);
    expect(await syncShopifyOrders("shop-db", "owner", 7, "actor")).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    expect(m.orders).toHaveBeenCalledWith("shop.myshopify.com", "token", "2026-10-14T12:00:00.000Z", undefined);
    expect(m.db.$transaction).toHaveBeenCalledTimes(1);
    expect(m.tx.shopifyOrderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shopifyLineId: line.id, orderId: "order-db", shopId: "shop-db", variantId: "variant-db", quantity: 3, currentQuantity: 2, price: 12.5, discountedPrice: 10, sku: "BOX-RED", currency: "MYR" }) });
    expect(m.tx.shopifyOrder.update.mock.invocationCallOrder[0] ?? m.tx.shopifyOrder.create.mock.invocationCallOrder[0]!).toBeLessThan(m.tx.shopifyOrderItem.deleteMany.mock.invocationCallOrder[0]!);
  });

  it.each([{ cancelledAt: "2026-10-20T00:00:00Z", closed: true, expected: "cancelled" }, { cancelledAt: null, closed: true, expected: "closed" }, { cancelledAt: null, closed: false, expected: "open" }])("derives $expected without borrowing payment or fulfillment status", async ({ cancelledAt, closed, expected }) => {
    m.orders.mockResolvedValue([{ ...order(), cancelledAt, closed }]);
    await syncShopifyOrders("shop-db", "owner");
    expect(m.tx.shopifyOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: expected }) }));
  });

  it("never falls back to a nontransactional item write after the transaction rejects", async () => {
    m.orders.mockResolvedValue([order()]);
    m.db.$transaction.mockRejectedValue(new Error("transaction aborted"));
    const result = await syncShopifyOrders("shop-db", "owner");
    expect(result).toMatchObject({ synced: 0, created: 0, updated: 0, errors: [expect.stringContaining("transaction aborted")] });
    expect(m.tx.shopifyOrderItem.deleteMany).not.toHaveBeenCalled();
    // This checks the transaction boundary, not MongoDB's rollback implementation.
  });

  knownGap("KNOWN GAP SHOPIFY-FRESHNESS: incomplete retrieval must not advance complete shop freshness", async () => {
    m.orders.mockResolvedValue([{ ...order(), lineItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } }, lineItemsFetchError: "page failed" }]);
    const result = await syncShopifyOrders("shop-db", "owner");
    expect(result.errors).toHaveLength(1);
    expect(m.db.shopifyShop.update).not.toHaveBeenCalled();
  });
});

describe("Shopify finance persistence, rather than empty-result forwarding", () => {
  it("stores refund transactions once when they also occur in the order transaction list", async () => {
    const sale = transaction("sale");
    const refund = { ...transaction("refund", "-2.50"), kind: "REFUND" };
    m.finance.mockResolvedValue([{ id: "order", transactions: [sale, refund], refunds: [{ id: "refund-object", createdAt: "2026-10-02T00:00:00Z", processedAt: null, transactions: { nodes: [refund] } }] }]);
    expect(await syncShopifyFinance("shop-db", "owner")).toEqual({ synced: 2, created: 2, updated: 0, errors: [] });
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledTimes(2);
    expect(m.db.marketplaceFinancialRecord.upsert.mock.calls.map(([args]) => args.create.externalId)).toEqual(["refund", "sale"]);
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "refund", orderExternalId: "order", feeType: "refund_transaction", amountMinor: "-250", amountScale: 2, amount: null, occurredAt: new Date("2026-10-01T00:00:00Z") }) }));
    expect(m.db.marketplaceFinancialRecord.upsert.mock.invocationCallOrder[1]).toBeLessThan(m.capability.mock.invocationCallOrder[0]!);
  });

  it.each([
    { amount: "0.00", minor: "0", scale: 2 }, { amount: "+0001.250", minor: "1250", scale: 3 },
    { amount: "9007199254740993.01", minor: "900719925474099301", scale: 2 }, { amount: "invalid", minor: null, scale: 2 },
  ])("preserves exact precision or marks malformed source money unknown: $amount", async ({ amount, minor, scale }) => {
    m.finance.mockResolvedValue([{ id: "order", transactions: [{ ...transaction("tx", amount), processedAt: "invalid", createdAt: null }], refunds: [] }]);
    m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue({ id: "existing" });
    expect(await syncShopifyFinance("shop-db", "owner")).toMatchObject({ synced: 1, created: 0, updated: 1 });
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ amountMinor: minor, amountScale: scale, amount: null, occurredAt: null, unknownReason: minor === null ? "source_value_malformed" : "source_observed_unverified" }) }));
  });

  it("reports a persistence failure and continues independent orders", async () => {
    m.finance.mockResolvedValue(["bad", "good"].map((id) => ({ id, transactions: [transaction(id)], refunds: [] })));
    m.db.marketplaceFinancialRecord.upsert.mockRejectedValueOnce(new Error("write failed"));
    expect(await syncShopifyFinance("shop-db", "owner")).toEqual({ synced: 1, created: 1, updated: 0, errors: ["Order bad: write failed"] });
  });

  it("marks a failed provider read failed even if recording capability also fails", async () => {
    const original = new Error("provider unavailable");
    m.finance.mockRejectedValue(original);
    m.capability.mockRejectedValue(new Error("capability store unavailable"));
    await expect(syncShopifyFinance("shop-db", "owner")).rejects.toBe(original);
    expect(isShopSyncing("shop-db")).toBe(false);
    expect(m.db.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  });
});

describe("Shopify ownership, retry and lock lifecycle", () => {
  it.each(["SCHEMA_INVALID", "ACCESS_DENIED", "TEMPORARY", "MALFORMED_RESPONSE"] as const)("preserves typed %s failures for durable task settlement without blind local retries", async (code) => {
    const error = new ShopifyProviderError(code, 200, "fixture-request");
    m.finance.mockRejectedValue(error);
    await expect(syncShopifyFinance("shop-db", "owner")).rejects.toBe(error);
    expect(m.finance).toHaveBeenCalledTimes(1);
    expect(m.db.marketplaceFinancialRecord.upsert).not.toHaveBeenCalled();
    expect(m.db.shopifyShop.update).not.toHaveBeenCalled();
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it.each([syncShopifyProducts, syncShopifyOrders, syncShopifyFinance])("retains typed authorization errors from preflight", async (sync) => {
    const error = new ShopifyProviderError("ACCESS_DENIED", 401, "fixture-request");
    m.token.mockResolvedValue({ valid: false, error: error.message, providerError: error });
    await expect(sync("shop-db", "owner")).rejects.toBe(error);
    expect(m.products).not.toHaveBeenCalled();
    expect(m.orders).not.toHaveBeenCalled();
    expect(m.finance).not.toHaveBeenCalled();
  });

  it("bounds local throttle retries and preserves the final typed error", async () => {
    const error = new ShopifyProviderError("THROTTLED", 200, "fixture-request");
    m.finance.mockRejectedValue(error);
    const result = syncShopifyFinance("shop-db", "owner").catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();
    expect(await result).toBe(error);
    expect(m.finance).toHaveBeenCalledTimes(4);
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it.each([syncShopifyProducts, syncShopifyOrders, syncShopifyFinance])("rejects unowned shops before token validation", async (sync) => {
    m.db.shopifyShop.findFirst.mockResolvedValue(null);
    await expect(sync("shop-db", "owner")).rejects.toThrow("not found");
    expect(m.token).not.toHaveBeenCalled();
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it.each([syncShopifyProducts, syncShopifyOrders, syncShopifyFinance])("releases its lock after token validation fails", async (sync) => {
    m.token.mockResolvedValue({ valid: false, error: "denied" });
    await expect(sync("shop-db", "owner")).rejects.toThrow("denied");
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it("refuses overlapping streams for one shop while allowing a distinct shop", async () => {
    let release!: (value: []) => void;
    const pending = new Promise<[]>((resolve) => { release = resolve; });
    m.products.mockReturnValueOnce(pending).mockResolvedValue([]);
    const first = syncShopifyProducts("shop-db", "owner");
    await vi.advanceTimersByTimeAsync(0);
    expect(isShopSyncing("shop-db")).toBe(true);
    await expect(syncShopifyOrders("shop-db", "owner")).rejects.toThrow("already in progress");
    await expect(syncShopifyProducts("shop-db", "owner")).rejects.toThrow("already in progress");
    await expect(syncShopifyFinance("shop-db", "owner")).rejects.toThrow("already in progress");
    await expect(syncShopifyProducts("other-shop", "owner")).resolves.toMatchObject({ errors: [] });
    release([]);
    await first;
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it("executes exponential retry on throttling and releases the lock afterward", async () => {
    m.products.mockRejectedValueOnce(new Error("throttled")).mockResolvedValue([]);
    const result = syncShopifyProducts("shop-db", "owner");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ errors: [] });
    expect(m.products).toHaveBeenCalledTimes(2);
    expect(isShopSyncing("shop-db")).toBe(false);
  });

  it("runs both full-sync streams in sequence with actor attribution", async () => {
    await expect(syncShopifyAll("shop-db", "owner", "actor")).resolves.toMatchObject({ products: { errors: [] }, orders: { errors: [] } });
    expect(m.products.mock.invocationCallOrder[0]).toBeLessThan(m.orders.mock.invocationCallOrder[0]!);
    expect(m.db.syncLog.create.mock.calls.map(([args]) => args.data.userId)).toEqual(["actor", "actor"]);
    expect(isShopSyncing("shop-db")).toBe(false);
  });
});
