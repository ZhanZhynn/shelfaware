import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAllFinanceTransactionDetailsCustom, setMarketplaceCapability, validateLazadaToken, createLazadaShopContext, ensureFreshLazadaToken, invalidate } = vi.hoisted(() => ({
  prismaMock: {
    lazadaShop: { findFirst: vi.fn() },
    lazadaOrder: { findMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getAllFinanceTransactionDetailsCustom: vi.fn(),
  setMarketplaceCapability: vi.fn(),
  validateLazadaToken: vi.fn(),
  createLazadaShopContext: vi.fn((shop) => ({ shopId: shop.id, userId: shop.userId, sellerId: shop.sellerId, countryCode: shop.countryCode, accessToken: shop.accessToken, refreshToken: shop.refreshToken, tokenExpiry: shop.tokenExpiry, refreshExpiry: shop.refreshExpiry })),
  ensureFreshLazadaToken: vi.fn((context) => context),
  invalidate: vi.fn(),
}));

vi.mock("./server", () => ({ createLazadaShopContext, ensureFreshLazadaToken, validateLazadaToken }));
vi.mock("./custom-api", () => ({ getAllFinanceTransactionDetailsCustom }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));
vi.mock("@/lib/server/lazada-reconciliation", () => ({ invalidateLazadaStatementReconciliations: invalidate }));

import { syncLazadaFinance } from "./sync";
import { lazadaFinanceIdentity } from "./finance-identity";

describe("Lazada finance sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lazadaShop.findFirst.mockResolvedValue({ id: "shop-record", userId: "user-record", sellerId: "seller-record", countryCode: "my", accessToken: "token-a", refreshToken: "refresh-a", tokenExpiry: null, refreshExpiry: null });
    prismaMock.syncLog.create.mockResolvedValue({ id: "sync-log" });
    prismaMock.syncLog.update.mockResolvedValue({});
    prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([]);
    prismaMock.marketplaceFinancialRecord.upsert.mockResolvedValue({});
    prismaMock.marketplaceFinancialRecord.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.marketplaceFinancialRecord.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation((work) => work(prismaMock));
    prismaMock.lazadaOrder.findMany.mockResolvedValue([]);
    validateLazadaToken.mockResolvedValue({ valid: true });
    setMarketplaceCapability.mockResolvedValue({});
  });

  it("maps only Lazada's documented transaction statement reference", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([{
      transaction_number: "SG103EF-1P9VK1A",
      statement: "11 May 2016 - 17 May 2016",
      amount: "-0.62",
      order_no: "123445666666",
    }]);

    await syncLazadaFinance("seller-record", "user-record");

    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ statementExternalId: "11 May 2016 - 17 May 2016", amountMinor: "-62", amountScale: 2 }),
    }));
  });

  it("passes the authorized internal shop context to every finance call", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([]);

    await syncLazadaFinance("seller-record", "user-record");

    expect(getAllFinanceTransactionDetailsCustom).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: "shop-record", sellerId: "seller-record", accessToken: "token-a" }),
      expect.any(Object),
    );
    expect(validateLazadaToken).toHaveBeenCalledWith(expect.objectContaining({ shopId: "shop-record" }));
  });

  it("honors bounded local-date windows, links only the selected shop's orders, and retains unlinked adjustments", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([
      { transaction_number: "inside", transaction_date: "2026-08-01 10:00:00", amount: "7.93", fee_name: "Reversal Commission", order_no: "order-1", currency: "MYR" },
      { transaction_number: "weight", transaction_date: "2026-08-01 11:00:00", amount: "-1.20", fee_name: "Wrong Weight Adjustment" },
      { transaction_number: "outside", transaction_date: "2026-08-02 10:00:00", amount: "3.00" },
    ]);
    prismaMock.lazadaOrder.findMany.mockResolvedValue([{ id: "internal-order", lazadaOrderId: "order-1" }]);
    const result = await syncLazadaFinance("seller-record", "user-record", { from: "2026-08-01T00:00:00+08:00", to: "2026-08-01T23:59:59+08:00" });
    expect(result.synced).toBe(2);
    expect(getAllFinanceTransactionDetailsCustom).toHaveBeenCalledWith(expect.anything(), { start_time: "2026-08-01T00:00:00+08:00", end_time: "2026-08-01T23:59:59+08:00" });
    expect(prismaMock.lazadaOrder.findMany).toHaveBeenCalledWith({ where: { shopId: "shop-record", lazadaOrderId: { in: ["order-1"] } }, select: { id: true, lazadaOrderId: true, items: { select: { lazadaOrderItemId: true } } } });
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ rawPayload: expect.objectContaining({ transaction_number: "inside" }), amountMinor: "793", currency: "MYR", orderInternalId: "internal-order", orderLinkState: "linked" }) }));
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ rawPayload: expect.objectContaining({ transaction_number: "weight" }), orderExternalId: null, orderLinkState: "not_applicable" }) }));
  });

  it("stores every fee component under a shared transaction number without overwriting another monetary row", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([
      { transaction_number: "shared-source", fee_type: "13", fee_name: "Item Price Credit", amount: "20.00", order_no: "order-1", orderItem_no: "line-1" },
      { transaction_number: "shared-source", fee_type: "14", fee_name: "Commission", amount: "-2.00", order_no: "order-1", orderItem_no: "line-1" },
    ]);
    const result = await syncLazadaFinance("seller-record", "user-record");
    expect(result).toMatchObject({ created: 2, updated: 0, errors: [] });
    const rows = prismaMock.marketplaceFinancialRecord.upsert.mock.calls.map(([request]) => request.create);
    expect(new Set(rows.map((row) => row.externalId)).size).toBe(2);
    expect(rows.map((row) => row.amountMinor)).toEqual(["2000", "-200"]);
    expect(rows.every((row) => row.rawPayload.transaction_number === "shared-source")).toBe(true);
  });

  it("upgrades a provably matching legacy component in place without double-counting it", async () => {
    const source = { transaction_number: "legacy-source", fee_type: "13", amount: "20.00", order_no: "order-1", orderItem_no: "line-1" };
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([source]);
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([{ id: "legacy-id", shopId: "shop-record", externalId: "legacy-source", feeType: "13", orderExternalId: "order-1", itemExternalId: "line-1", rawPayload: source, statementExternalId: null }]);
    const result = await syncLazadaFinance("seller-record", "user-record");
    expect(result).toMatchObject({ created: 0, updated: 1, errors: [] });
    expect(prismaMock.marketplaceFinancialRecord.update).toHaveBeenCalledWith({ where: { id: "legacy-id" }, data: expect.objectContaining({ externalId: lazadaFinanceIdentity(source).externalId, amountMinor: "2000" }) });
    expect(prismaMock.marketplaceFinancialRecord.upsert).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("replays the same component set idempotently", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([
      { transaction_number: "shared-source", fee_type: "13", amount: "20.00" },
      { transaction_number: "shared-source", fee_type: "14", amount: "-2.00" },
    ]);
    const stored = new Map<string, Record<string, unknown>>();
    prismaMock.marketplaceFinancialRecord.findUnique.mockImplementation(async ({ where }) => stored.get(where.platform_shopId_externalId.externalId) ?? null);
    prismaMock.marketplaceFinancialRecord.upsert.mockImplementation(async ({ where, create, update }) => {
      const key = where.platform_shopId_externalId.externalId;
      const previous = stored.get(key);
      const saved = previous ? { ...previous, ...update } : { ...create, id: `record-${stored.size}` };
      stored.set(key, saved);
      return saved;
    });
    expect(await syncLazadaFinance("seller-record", "user-record")).toMatchObject({ created: 2, updated: 0 });
    expect(await syncLazadaFinance("seller-record", "user-record")).toMatchObject({ created: 0, updated: 2 });
    expect(stored.size).toBe(2);
    expect([...stored.values()].map((row) => row.amountMinor)).toEqual(["2000", "-200"]);
  });

  it("parses English finance dates but rejects ambiguous numeric dates without inventing an occurrence time", async () => {
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([{ transaction_number: "source", fee_type: "13", amount: "20.00", transaction_date: "01 Aug 2026" }]);
    const range = { from: "2026-08-01T00:00:00+08:00", to: "2026-08-01T23:59:59+08:00" };
    expect(await syncLazadaFinance("seller-record", "user-record", range)).toMatchObject({ synced: 1, errors: [] });
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ occurredAt: new Date("2026-07-31T16:00:00Z") }) }));
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([{ transaction_number: "source", amount: "20.00", transaction_date: "01/08/2026" }]);
    await expect(syncLazadaFinance("seller-record", "user-record", range)).rejects.toMatchObject({ code: "MISSING_FINANCE_TIMESTAMP", fields: ["timestamp_shape_DD_DD_DDDD"] });
  });

  it("atomically consolidates a matching v2 duplicate even when the raw alias belongs to a different fee, and resolves its provider line reference", async () => {
    const source = { transaction_number: "1001", fee_type: "239", fee_name: "Sponsored Affiliates", amount: "-0.64", transaction_date: "02 Aug 2026", order_no: "order-1", statement: "statement" };
    const identity = lazadaFinanceIdentity(source);
    const facts = { shopId: "shop-record", feeType: "239", feeName: "Sponsored Affiliates", amountMinor: "-64", amountScale: 2, currency: null, occurredAt: new Date("2026-08-01T16:00:00Z"), statementExternalId: "statement", orderExternalId: "order-1", orderInternalId: "internal-order", financialQuality: "unknown", updatedAt: new Date("2026-10-20T00:00:00Z"), rawPayload: source };
    getAllFinanceTransactionDetailsCustom.mockResolvedValue([source]);
    prismaMock.lazadaOrder.findMany.mockResolvedValue([{ id: "internal-order", lazadaOrderId: "order-1", items: [{ lazadaOrderItemId: 1001 }] }]);
    prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue({ id: "canonical", externalId: identity.externalId, ...facts });
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([
      { id: "raw-credit", ...facts, externalId: "1001", feeType: "13", feeName: "Item Price Credit", rawPayload: { ...source, fee_type: "13", fee_name: "Item Price Credit" } },
      { id: "old-affiliate", externalId: identity.legacyExternalId, ...facts },
    ]);
    expect(await syncLazadaFinance("seller-record", "user-record")).toMatchObject({ created: 0, updated: 1, mergedAliases: 1, errors: [] });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceFinancialRecord.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "canonical", shopId: "shop-record", updatedAt: facts.updatedAt }), data: expect.objectContaining({ itemExternalId: "1001", rawPayload: expect.objectContaining({ shelfaware_alias_merges: [expect.objectContaining({ id: "old-affiliate" })], shelfaware_item_link_basis: "provider_transaction_number" }) }) });
    expect(prismaMock.marketplaceFinancialRecord.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ platform: "lazada", shopId: "shop-record", OR: [expect.objectContaining({ id: "old-affiliate", amountMinor: "-64", financialQuality: "unknown" })] }) });
    expect(JSON.stringify(prismaMock.marketplaceFinancialRecord.deleteMany.mock.calls)).not.toContain("raw-credit");

    prismaMock.marketplaceFinancialRecord.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(syncLazadaFinance("seller-record", "user-record")).rejects.toMatchObject({ code: "INCONSISTENT_FINANCE_ALIAS_CONCURRENT_CHANGE" });
    prismaMock.marketplaceFinancialRecord.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.marketplaceFinancialRecord.deleteMany.mockClear();
    await expect(syncLazadaFinance("seller-record", "user-record")).rejects.toMatchObject({ code: "INCONSISTENT_FINANCE_ALIAS_CONCURRENT_CHANGE" });
    expect(prismaMock.marketplaceFinancialRecord.deleteMany).not.toHaveBeenCalled();
  });
});
