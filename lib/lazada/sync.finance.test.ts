import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAllFinanceTransactionDetailsCustom, setMarketplaceCapability, validateLazadaToken } = vi.hoisted(() => ({
  prismaMock: {
    lazadaShop: { findFirst: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  getAllFinanceTransactionDetailsCustom: vi.fn(),
  setMarketplaceCapability: vi.fn(),
  validateLazadaToken: vi.fn(),
}));

vi.mock("./server", () => ({ setActiveSeller: vi.fn(), validateLazadaToken }));
vi.mock("./custom-api", () => ({ getAllFinanceTransactionDetailsCustom }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncLazadaFinance } from "./sync";

describe("Lazada finance sync", () => {
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
});
