import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAllFinanceTransactionDetailsCustom, setMarketplaceCapability, validateLazadaToken, createLazadaShopContext, ensureFreshLazadaToken, invalidate } = vi.hoisted(() => ({
  prismaMock: {
    lazadaShop: { findFirst: vi.fn() },
    lazadaOrder: { findMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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
    expect(prismaMock.lazadaOrder.findMany).toHaveBeenCalledWith({ where: { shopId: "shop-record", lazadaOrderId: { in: ["order-1"] } }, select: { id: true, lazadaOrderId: true } });
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
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([{ id: "legacy-id", externalId: "legacy-source", feeType: "13", orderExternalId: "order-1", itemExternalId: "line-1", rawPayload: source, statementExternalId: null }]);
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
});
