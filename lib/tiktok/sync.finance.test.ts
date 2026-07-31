import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  getOrderStatementTransactions,
  getStatementTransactions,
  setMarketplaceCapability,
  validateTikTokToken,
  ensureFreshToken,
  getActiveShopCipher,
} = vi.hoisted(() => ({
  prismaMock: {
    tikTokShop: { findFirst: vi.fn() },
    tikTokOrder: { findMany: vi.fn() },
    marketplaceFinancialRecord: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
  },
  getOrderStatementTransactions: vi.fn(),
  getStatementTransactions: vi.fn(),
  setMarketplaceCapability: vi.fn(),
  validateTikTokToken: vi.fn(),
  ensureFreshToken: vi.fn(),
  getActiveShopCipher: vi.fn(),
}));

vi.mock("./server", () => ({
  setActiveShop: vi.fn(),
  validateTikTokToken,
  ensureFreshToken,
  getActiveShopCipher,
}));
vi.mock("./custom-api", () => ({ getOrderStatementTransactions, getStatementTransactions }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncTikTokFinance, syncTikTokPayoutStatements } from "./sync";

describe("TikTok final statement evidence sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tikTokShop.findFirst.mockResolvedValue({ id: "shop-record" });
    prismaMock.tikTokOrder.findMany.mockResolvedValue([{ tiktokOrderId: "order-1" }]);
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([]);
    prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceFinancialRecord.upsert.mockResolvedValue({});
    prismaMock.syncLog.create.mockResolvedValue({ id: "sync-log" });
    prismaMock.syncLog.update.mockResolvedValue({});
    validateTikTokToken.mockResolvedValue({ valid: true });
    ensureFreshToken.mockResolvedValue("seller-token");
    getActiveShopCipher.mockResolvedValue("shop-cipher");
    setMarketplaceCapability.mockResolvedValue({});
  });

  it("links per-order transaction rows to their documented statement ID", async () => {
    getOrderStatementTransactions.mockResolvedValue({
      order_id: "order-1",
      currency: "MYR",
      sku_transactions: [{ statement_id: "statement-1", sku_id: "sku-1", settlement_amount: "1.25" }],
    });

    await syncTikTokFinance("shop-1", "user-1");

    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        externalId: "statement-1",
        statementExternalId: "statement-1",
        amountMinor: "125",
        amountScale: 2,
      }),
    }));
  });

  it("paginates distinct ledger statement IDs and persists only final settled payouts", async () => {
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([
      { statementExternalId: "statement-1" },
      { statementExternalId: "statement-1" },
      { statementExternalId: "statement-2" },
    ]);
    getStatementTransactions
      .mockResolvedValueOnce({
        id: "statement-1",
        status: "SETTLED",
        currency: "GBP",
        payable_amount: "150.00",
        total_settlement_amount: "130.00",
        create_time: 1685548800,
        next_page_token: "next-page",
        transactions: [{ id: "transaction-1" }],
      })
      .mockResolvedValueOnce({
        id: "statement-1",
        status: "SETTLED",
        currency: "GBP",
        payable_amount: "150.00",
        total_settlement_amount: "130.00",
        transactions: [{ id: "transaction-2" }],
      })
      .mockResolvedValueOnce({ id: "statement-2", status: "PENDING", payable_amount: "1.00" });

    await syncTikTokPayoutStatements("shop-1", "user-1");

    expect(prismaMock.marketplaceFinancialRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ statementExternalId: { not: null } }),
      distinct: ["statementExternalId"],
    }));
    expect(getStatementTransactions).toHaveBeenNthCalledWith(1, "seller-token", "shop-cipher", "statement-1", 100, undefined);
    expect(getStatementTransactions).toHaveBeenNthCalledWith(2, "seller-token", "shop-cipher", "statement-1", 100, "next-page");
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { platform_shopId_externalId: { platform: "tiktok", shopId: "shop-record", externalId: "payout_statement:statement-1" } },
      create: expect.objectContaining({
        statementExternalId: "statement-1",
        transactionType: "payout_statement",
        feeType: "statement_settled",
        amountMinor: "15000",
        amountScale: 2,
        amount: null,
        rawPayload: expect.objectContaining({ total_settlement_amount: "130.00", transactions: [{ id: "transaction-1" }, { id: "transaction-2" }] }),
      }),
    }));
    expect(setMarketplaceCapability).toHaveBeenCalledWith(expect.objectContaining({
      platform: "tiktok",
      shopId: "shop-record",
      capability: "settlements",
      state: "available",
    }));
  });

  it("does not observe settlement capability without a SETTLED statement", async () => {
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([{ statementExternalId: "statement-1" }]);
    getStatementTransactions.mockResolvedValue({ id: "statement-1", status: "PENDING", payable_amount: "1.00" });

    await syncTikTokPayoutStatements("shop-1", "user-1");

    expect(prismaMock.marketplaceFinancialRecord.upsert).not.toHaveBeenCalled();
    expect(setMarketplaceCapability).not.toHaveBeenCalled();
  });
});
