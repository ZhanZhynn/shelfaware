import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shop: { findFirst: vi.fn(), update: vi.fn() }, order: { findFirst: vi.fn() }, transaction: vi.fn(),
  tx: { lazadaOrder: { create: vi.fn(), update: vi.fn() }, lazadaOrderItem: { deleteMany: vi.fn(), create: vi.fn() } },
  runWithSyncLog: vi.fn(), orders: vi.fn(), items: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ default: { lazadaShop: mocks.shop, lazadaOrder: mocks.order, $transaction: mocks.transaction } }));
vi.mock("./server", () => ({ createLazadaShopContext: (shop: unknown) => shop, ensureFreshLazadaToken: async (shop: unknown) => shop, validateLazadaToken: async () => ({ valid: true }) }));
vi.mock("./custom-api", () => ({ getAllOrdersCustom: mocks.orders, getMultipleOrderItemsCustom: mocks.items }));
vi.mock("@/lib/sync/run-with-sync-log", () => ({ runWithSyncLog: mocks.runWithSyncLog }));

import { syncLazadaOrders } from "./sync";

const sourceOrder = { order_id: 10, order_number: "10", statuses: ["confirmed"], price: "20.00", shipping_fee: "3.00", created_at: "2026-08-01 09:00:00 +0800", updated_at: "2026-09-01 10:00:00 +0800" };
const sourceItem = { order_item_id: 1001, item_id: 1, sku_id: 2, status: "confirmed", item_price: "20.00", paid_price: "19.00", currency: "MYR" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shop.findFirst.mockResolvedValue({ id: "shop-1", userId: "owner", sellerId: "seller", countryCode: "my" });
  mocks.order.findFirst.mockResolvedValue({ id: "order-1" });
  mocks.orders.mockResolvedValue([sourceOrder]);
  mocks.items.mockResolvedValue([{ order_id: 10, order_items: [sourceItem] }]);
  mocks.runWithSyncLog.mockImplementation((_context, work) => work());
  mocks.transaction.mockImplementation((work) => work(mocks.tx));
  mocks.tx.lazadaOrder.update.mockResolvedValue({ id: "order-1" });
  mocks.tx.lazadaOrder.create.mockResolvedValue({ id: "order-1" });
  mocks.tx.lazadaOrderItem.create.mockResolvedValue({});
});

describe("Lazada order repair", () => {
  it("passes both historical creation bounds and commits the header and item replacement atomically", async () => {
    const range = { from: "2026-08-01T00:00:00+08:00", to: "2026-08-01T23:59:59+08:00" };
    const result = await syncLazadaOrders("seller", "owner", range);
    expect(mocks.orders).toHaveBeenCalledWith(expect.anything(), { created_after: range.from, created_before: range.to });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.lazadaOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: "confirmed", lazadaCreatedAt: new Date("2026-08-01T01:00:00Z") }) }));
    expect(mocks.tx.lazadaOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: null, paidPrice: 19 }) }));
    expect(result).toMatchObject({ synced: 1, updated: 1, errors: [] });
  });

  it("follows updates for rolling syncs so older orders can advance", async () => {
    await syncLazadaOrders("seller", "owner");
    expect(mocks.orders).toHaveBeenCalledWith(expect.anything(), { update_after: expect.any(String), update_before: expect.any(String) });
  });

  it("normalizes documented string IDs and records only unanimous source payment timestamps", async () => {
    mocks.items.mockResolvedValue([{ order_id: "10", order_items: [{ ...sourceItem, order_item_id: "1001", payment_time: "1785546000000" }] }]);
    const result = await syncLazadaOrders("seller", "owner");
    expect(result.synced).toBe(1);
    expect(mocks.tx.lazadaOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lazadaOrderItemId: 1001 }) }));
    expect(mocks.tx.lazadaOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paidAt: new Date(1785546000000) }) }));
  });

  it("keeps returns and unfamiliar statuses distinct from pending/unpaid or a settled refund", async () => {
    mocks.orders.mockResolvedValue([{ ...sourceOrder, statuses: ["future_status"] }]);
    mocks.items.mockResolvedValue([{ order_id: 10, order_items: [{ ...sourceItem, status: "Package Returned" }] }]);
    await syncLazadaOrders("seller", "owner");
    expect(mocks.tx.lazadaOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: "unknown", paymentStatus: "unknown" }) }));
    expect(mocks.tx.lazadaOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "returned" }) }));
  });

  it("never deletes stored lines or advances a header when its item batch failed", async () => {
    mocks.items.mockRejectedValue(new Error("provider unavailable"));
    const result = await syncLazadaOrders("seller", "owner");
    expect(result).toMatchObject({ synced: 0, updated: 0 });
    expect(result.errors[0]).toContain("ORDER_ITEMS_UNAVAILABLE");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.shop.update).not.toHaveBeenCalled();
  });

  it("rejects duplicate item identities before replacing anything", async () => {
    mocks.items.mockResolvedValue([{ order_id: 10, order_items: [sourceItem, sourceItem] }]);
    const result = await syncLazadaOrders("seller", "owner");
    expect(result.errors[0]).toContain("ORDER_ITEMS_INVALID_IDENTITIES");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not report a successful order when its transactional item write fails", async () => {
    mocks.tx.lazadaOrderItem.create.mockRejectedValueOnce(new Error("write failed"));
    const result = await syncLazadaOrders("seller", "owner");
    expect(result).toMatchObject({ synced: 0, updated: 0 });
    expect(result.errors[0]).toContain("write failed");
  });
});
