import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAllFinanceTransactionDetailsCustom, setMarketplaceCapability, validateLazadaToken, createLazadaShopContext, ensureFreshLazadaToken } = vi.hoisted(() => ({
  prismaMock: {
    lazadaShop: { findFirst: vi.fn() },
    lazadaOrder: { findMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  getAllFinanceTransactionDetailsCustom: vi.fn(),
  setMarketplaceCapability: vi.fn(),
  validateLazadaToken: vi.fn(),
  createLazadaShopContext: vi.fn((shop) => ({ shopId: shop.id, userId: shop.userId, sellerId: shop.sellerId, countryCode: shop.countryCode, accessToken: shop.accessToken, refreshToken: shop.refreshToken, tokenExpiry: shop.tokenExpiry, refreshExpiry: shop.refreshExpiry })),
  ensureFreshLazadaToken: vi.fn((context) => context),
}));

vi.mock("./server", () => ({ createLazadaShopContext, ensureFreshLazadaToken, validateLazadaToken }));
vi.mock("./custom-api", () => ({ getAllFinanceTransactionDetailsCustom }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncLazadaFinance } from "./sync";

describe("Lazada finance sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lazadaShop.findFirst.mockResolvedValue({ id: "shop-record", userId: "user-record", sellerId: "seller-record", countryCode: "my", accessToken: "token-a", refreshToken: "refresh-a", tokenExpiry: null, refreshExpiry: null });
    prismaMock.syncLog.create.mockResolvedValue({ id: "sync-log" });
    prismaMock.syncLog.update.mockResolvedValue({});
    prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
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
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "inside", amountMinor: "793", currency: "MYR", orderInternalId: "internal-order", orderLinkState: "linked" }) }));
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "weight", orderExternalId: null, orderLinkState: "not_applicable" }) }));
  });
});
