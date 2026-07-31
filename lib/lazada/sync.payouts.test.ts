import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getPayoutStatusCustom, setMarketplaceCapability, validateLazadaToken } = vi.hoisted(() => ({
  prismaMock: {
    lazadaShop: { findFirst: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  getPayoutStatusCustom: vi.fn(),
  setMarketplaceCapability: vi.fn(),
  validateLazadaToken: vi.fn(),
}));

vi.mock("./server", () => ({ setActiveSeller: vi.fn(), validateLazadaToken }));
vi.mock("./custom-api", () => ({ getPayoutStatusCustom }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncLazadaPayoutStatements } from "./sync";

describe("Lazada payout statement sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lazadaShop.findFirst.mockResolvedValue({ id: "shop-record" });
    prismaMock.syncLog.create.mockResolvedValue({ id: "sync-log" });
    prismaMock.syncLog.update.mockResolvedValue({});
    prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceFinancialRecord.upsert.mockResolvedValue({});
    validateLazadaToken.mockResolvedValue({ valid: true });
    setMarketplaceCapability.mockResolvedValue({});
  });

  it("persists a paid payout under a non-transaction ID with exact amount and observes settlements", async () => {
    getPayoutStatusCustom.mockResolvedValue([{
      statement_number: "EG100RT-20141228",
      payout: "3962.41 EUR",
      paid: "1",
      created_at: "2018-01-04 00:23:04",
    }]);

    await syncLazadaPayoutStatements("seller-record", "user-record");

    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { platform_shopId_externalId: { platform: "lazada", shopId: "shop-record", externalId: "payout:EG100RT-20141228" } },
      create: expect.objectContaining({
        transactionType: "payout_statement",
        statementExternalId: "EG100RT-20141228",
        feeType: "payout_paid",
        amountMinor: "396241",
        amountScale: 2,
        currency: "EUR",
        amount: null,
        rawPayload: expect.objectContaining({ paid: "1" }),
      }),
    }));
    expect(setMarketplaceCapability).toHaveBeenCalledWith(expect.objectContaining({
      platform: "lazada",
      shopId: "shop-record",
      capability: "settlements",
      state: "available",
    }));
  });

  it("does not observe settlement capability for unpaid statements", async () => {
    getPayoutStatusCustom.mockResolvedValue([{
      statement_number: "EG100RT-20141229",
      payout: "0.10 EUR",
      paid: "0",
    }]);

    await syncLazadaPayoutStatements("seller-record", "user-record");

    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ feeType: "payout_unpaid" }),
    }));
    expect(setMarketplaceCapability).not.toHaveBeenCalled();
  });
});
