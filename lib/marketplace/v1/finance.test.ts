import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
  accessibleMarketplaceShops: vi.fn(),
  getMarketplaceReconciliationStatus: vi.fn(),
  getProfitDetail: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({ prisma: { marketplaceFinancialRecord: { findMany: mocks.findMany, count: mocks.count, aggregate: mocks.aggregate } } }));
vi.mock("@/lib/marketplace/shops", () => ({ accessibleMarketplaceShops: mocks.accessibleMarketplaceShops }));
vi.mock("@/lib/marketplace/analytics/reconciliation-status", () => ({ getMarketplaceReconciliationStatus: mocks.getMarketplaceReconciliationStatus }));
vi.mock("@/lib/marketplace/analytics/profit-detail", () => ({ getProfitDetail: mocks.getProfitDetail }));

import {
  assertMarketplaceFinanceShop,
  getMarketplaceFinanceResult,
  getMarketplaceFinancialCoverage,
  listMarketplaceFinancialRecords,
  MarketplaceFinanceNotFoundError,
  MarketplaceFinanceValidationError,
  parseMarketplaceFinanceQuery,
} from "./finance";

describe("v1 marketplace finance queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.aggregate.mockResolvedValue({ _max: { sourceObservedAt: null } });
  });
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

  it("maps scoped filters to persisted fields and validates dates, enums, and ISO currency", async () => {
    const query = parseMarketplaceFinanceQuery(new URLSearchParams({
      shopId: "a".repeat(24), dateFrom: "2026-01-01", dateTo: "2026-01-02T01:00:00+08:00", dateBasis: "observed",
      transactionType: "fee", financialQuality: "unknown", linkState: "unclassified", currency: "MYR",
    }), "financial-records");
    mocks.findMany.mockResolvedValue([]);

    await listMarketplaceFinancialRecords("lazada", query as Parameters<typeof listMarketplaceFinancialRecords>[1]);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        platform: "lazada", shopId: "a".repeat(24), sourceObservedAt: {
          gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-01T17:00:00.000Z"),
        }, transactionType: "fee", financialQuality: "unknown", currency: "MYR",
        OR: [{ orderLinkState: null }, { orderLinkState: { isSet: false } }],
      },
    }));
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), currency: "RM" }), "financial-records")).toThrow(MarketplaceFinanceValidationError);
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), dateBasis: "created" }), "financial-records")).toThrow(MarketplaceFinanceValidationError);
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), dateFrom: "not-a-date" }), "reconciliation-status")).toThrow(MarketplaceFinanceValidationError);
    expect(parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), dateBasis: "observed", currency: "MYR", linkState: "unclassified" }), "reconciliation-status")).toMatchObject({ dateBasis: "observed", currency: "MYR", linkState: "unclassified" });
  });

  it("binds normalized filters into new cursors while accepting an empty legacy cursor", async () => {
    const first = {
      id: "b".repeat(24), shopId: "a".repeat(24), externalId: "row-1", statementExternalId: null, orderExternalId: null, orderInternalId: null,
      orderLinkState: null, itemExternalId: null, transactionType: null, feeType: null, feeName: null, amountMinor: "0", amountScale: 2,
      amount: null, currency: "MYR", occurredAt: new Date("2026-01-01T00:00:00.000Z"), sourceObservedAt: null, financialQuality: "unknown",
      unknownReason: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    mocks.findMany.mockResolvedValue([first, { ...first, id: "c".repeat(24) }]);
    const query = parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), limit: "1", dateBasis: "observed" }), "financial-records") as Parameters<typeof listMarketplaceFinancialRecords>[1];
    const page = await listMarketplaceFinancialRecords("shopee", query);

    expect(page.page.nextCursor).toBeTruthy();
    expect(() => parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), limit: "1", cursor: page.page.nextCursor!, dateBasis: "occurred" }), "financial-records")).not.toThrow();
    await expect(listMarketplaceFinancialRecords("shopee", { ...query, dateBasis: "occurred", cursor: page.page.nextCursor! })).rejects.toThrow("Invalid cursor");

    const legacyCursor = Buffer.from(JSON.stringify({ v: 1, platform: "shopee", filter: JSON.stringify({ platform: "shopee", shopId: "a".repeat(24) }), id: "b".repeat(24) })).toString("base64url");
    await expect(listMarketplaceFinancialRecords("shopee", { shopId: "a".repeat(24), limit: 1, dateBasis: "occurred", cursor: legacyCursor })).resolves.toBeDefined();
  });

  it("reports zero minor amounts as numeric while keeping amount and quality coverage distinct", async () => {
    mocks.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    mocks.aggregate.mockResolvedValue({ _max: { sourceObservedAt: new Date("2026-01-03T00:00:00.000Z") } });

    const coverage = await getMarketplaceFinancialCoverage("lazada", "a".repeat(24), {
      dateBasis: "occurred", financialQuality: "unknown", dateRange: { gte: new Date("2026-01-01T00:00:00.000Z") },
    });

    expect(coverage).toMatchObject({ state: "partial", usableRecords: 2, numericAmountRecords: 2, missingAmountRecords: 1, verifiedRecords: 1, unverifiedRecords: 2 });
    expect(mocks.count).toHaveBeenCalledTimes(4);
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ amountMinor: { not: null } })]) }) }));
  });

  it("requires a valid internal order ID when filtering linked records", async () => {
    const query = parseMarketplaceFinanceQuery(new URLSearchParams({ shopId: "a".repeat(24), linkState: "linked" }), "financial-records") as Parameters<typeof listMarketplaceFinancialRecords>[1];
    mocks.findMany.mockResolvedValue([]);

    await listMarketplaceFinancialRecords("lazada", query);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { platform: "lazada", shopId: "a".repeat(24), orderLinkState: "linked", orderInternalId: { not: null, isSet: true } },
    }));
  });

  it("allows RFC3339 profit dates and passes them through unchanged", async () => {
    const query = parseMarketplaceFinanceQuery(new URLSearchParams({ dateFrom: "2026-01-01T00:00:00+08:00", dateTo: "2026-01-02T00:00:00Z" }), "profit");
    mocks.getProfitDetail.mockResolvedValue({ metadata: { warnings: [] } });

    await getMarketplaceFinanceResult("shopee", { id: "user-1" } as never, "profit", query);

    const params = mocks.getProfitDetail.mock.calls[0]?.[2] as URLSearchParams;
    expect(params.get("dateFrom")).toBe("2026-01-01T00:00:00+08:00");
  });

  it("authorizes the selected internal shop against the caller's accessible shops", async () => {
    mocks.accessibleMarketplaceShops.mockResolvedValue([{ id: "a".repeat(24) }]);
    await expect(assertMarketplaceFinanceShop("shopee", { id: "user-1" } as never, "a".repeat(24))).resolves.toBeUndefined();
    await expect(assertMarketplaceFinanceShop("shopee", { id: "user-1" } as never, "b".repeat(24))).rejects.toBeInstanceOf(MarketplaceFinanceNotFoundError);
  });
});
