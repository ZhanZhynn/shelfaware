import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  accessibleMarketplaceShops: vi.fn(),
  getMarketplaceReconciliationStatus: vi.fn(),
  getProfitDetail: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({ prisma: { marketplaceFinancialRecord: { findMany: mocks.findMany } } }));
vi.mock("@/lib/marketplace/shops", () => ({ accessibleMarketplaceShops: mocks.accessibleMarketplaceShops }));
vi.mock("@/lib/marketplace/analytics/reconciliation-status", () => ({ getMarketplaceReconciliationStatus: mocks.getMarketplaceReconciliationStatus }));
vi.mock("@/lib/marketplace/analytics/profit-detail", () => ({ getProfitDetail: mocks.getProfitDetail }));

import {
  assertMarketplaceFinanceShop,
  listMarketplaceFinancialRecords,
  MarketplaceFinanceNotFoundError,
  MarketplaceFinanceValidationError,
  parseMarketplaceFinanceQuery,
} from "./finance";

describe("v1 marketplace finance queries", () => {
  it("requires canonical internal shop IDs and rejects duplicate or unknown filters", () => {
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "provider-shop-id" }), "financial-records")).toThrow(MarketplaceFinanceValidationError);
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams(`shopId=${"a".repeat(24)}&shopId=${"a".repeat(24)}`), "reconciliation-status")).toThrow(MarketplaceFinanceValidationError);
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), sellerId: "provider-id" }), "reconciliation-status")).toThrow(MarketplaceFinanceValidationError);
  });

  it("uses the local financial ledger with an internal shop ID and omits raw payloads", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "b".repeat(24), shopId: "a".repeat(24), externalId: "provider-row-1", statementExternalId: null, orderExternalId: "order-1", orderInternalId: null,
      orderLinkState: "linked", itemExternalId: null, transactionType: "fee", feeType: null, feeName: "commission", amountMinor: "120", amountScale: 2,
      amount: null, currency: "MYR", occurredAt: new Date("2026-01-01T00:00:00.000Z"), sourceObservedAt: null, financialQuality: "observed",
      unknownReason: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }]);

    const result = await listMarketplaceFinancialRecords("shopee", { shopId: "a".repeat(24), limit: 25 });

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platform: "shopee", shopId: "a".repeat(24) }, take: 26 }));
    expect(result).toMatchObject({ data: [{ id: "b".repeat(24), occurredAt: "2026-01-01T00:00:00.000Z" }], page: { limit: 25, nextCursor: null } });
    expect(result.data[0]).not.toHaveProperty("rawPayload");
  });

  it("authorizes the selected internal shop against the caller's accessible shops", async () => {
    mocks.accessibleMarketplaceShops.mockResolvedValue([{ id: "a".repeat(24) }]);
    await expect(assertMarketplaceFinanceShop("shopee", { id: "user-1" } as never, "a".repeat(24))).resolves.toBeUndefined();
    await expect(assertMarketplaceFinanceShop("shopee", { id: "user-1" } as never, "b".repeat(24))).rejects.toBeInstanceOf(MarketplaceFinanceNotFoundError);
  });
});
