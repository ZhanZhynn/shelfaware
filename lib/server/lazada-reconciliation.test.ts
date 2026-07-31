import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, ensureMarketplaceAnalyticsConnection, setMarketplaceFinancialReadiness } = vi.hoisted(() => ({
  prismaMock: {
    marketplaceFinancialRecord: { findMany: vi.fn() },
    lazadaOrder: { findMany: vi.fn() },
    marketplaceAnalyticsReconciliation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  ensureMarketplaceAnalyticsConnection: vi.fn(),
  setMarketplaceFinancialReadiness: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ ensureMarketplaceAnalyticsConnection, setMarketplaceFinancialReadiness }));

import { assessLazadaPayoutStatement, invalidateLazadaStatementReconciliations, reconcileLazadaPayoutStatements } from "./lazada-reconciliation";

const record = (overrides: Partial<{ id: string; externalId: string; statementExternalId: string | null; orderExternalId: string | null; transactionType: string | null; feeType: string | null; amountMinor: string | null; amountScale: number; currency: string | null; occurredAt: Date | null }> = {}) => ({
  id: "record", externalId: "transaction-1", statementExternalId: "statement-1", orderExternalId: "order-1", transactionType: "Payment", feeType: null, amountMinor: "100", amountScale: 2, currency: "MYR", occurredAt: null, ...overrides,
});

describe("Lazada payout reconciliation eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMarketplaceAnalyticsConnection.mockResolvedValue({ id: "connection-1" });
    prismaMock.marketplaceAnalyticsReconciliation.findFirst.mockResolvedValue(null);
    prismaMock.marketplaceAnalyticsReconciliation.create.mockResolvedValue({ id: "reconciliation-1" });
  });

  it("requires all linked orders to be complete and mature before accepting a paid statement", () => {
    const result = assessLazadaPayoutStatement({
      payout: record({ externalId: "payout-1", transactionType: "payout_statement", feeType: "payout_paid", amountMinor: "125" }),
      transactions: [record(), record({ id: "record-2", externalId: "transaction-2", amountMinor: "25", orderExternalId: "order-2" })],
      orders: [
        { lazadaOrderId: "order-1", completedAt: new Date("2026-01-01T00:00:00.000Z") },
        { lazadaOrderId: "order-2", completedAt: new Date("2026-01-15T00:00:00.000Z") },
      ],
      now: new Date("2026-02-13T23:59:59.999Z"),
    });
    expect(result).toMatchObject({ eligible: false, reason: "not_mature" });
  });

  it("only permits an exact or one-minor-unit payout with known currency and scale", () => {
    const result = assessLazadaPayoutStatement({
      payout: record({ externalId: "payout-1", transactionType: "payout_statement", feeType: "payout_paid", amountMinor: "101" }),
      transactions: [record()],
      orders: [{ lazadaOrderId: "order-1", completedAt: new Date("2026-01-01T00:00:00.000Z") }],
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ eligible: true, reconciliation: { comparison: "within_one_minor_unit" } });

    const unknownCurrency = assessLazadaPayoutStatement({
      payout: record({ externalId: "payout-1", transactionType: "payout_statement", feeType: "payout_paid", currency: null }),
      transactions: [record()],
      orders: [{ lazadaOrderId: "order-1", completedAt: new Date("2026-01-01T00:00:00.000Z") }],
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(unknownCurrency).toMatchObject({ eligible: false, reason: "incompatible_statement" });
  });

  it("does not reconcile transaction rows without a known linked completion", () => {
    const result = assessLazadaPayoutStatement({
      payout: record({ externalId: "payout-1", transactionType: "payout_statement", feeType: "payout_paid" }),
      transactions: [record({ orderExternalId: null })],
      orders: [],
    });
    expect(result).toEqual({ eligible: false, reason: "missing_order_completion", reconciliation: null });
  });

  it("persists approved metadata and readiness only for an eligible paid statement", async () => {
    const payout = record({ externalId: "payout-1", transactionType: "payout_statement", feeType: "payout_paid" });
    prismaMock.marketplaceFinancialRecord.findMany
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([record()]);
    prismaMock.lazadaOrder.findMany.mockResolvedValue([{ lazadaOrderId: "order-1", completedAt: new Date("2026-01-01T00:00:00.000Z") }]);

    await reconcileLazadaPayoutStatements({ userId: "user-1", shopId: "shop-1", now: new Date("2026-02-01T00:00:00.000Z") });

    expect(prismaMock.marketplaceAnalyticsReconciliation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decision: "approved", evidenceReference: "lazada:payout:statement-1", evidenceHash: expect.any(String) }),
    }));
    expect(setMarketplaceFinancialReadiness).toHaveBeenCalledWith(expect.objectContaining({ financeReady: true, reconciliationId: "reconciliation-1" }));

    vi.clearAllMocks();
    prismaMock.marketplaceFinancialRecord.findMany
      .mockResolvedValueOnce([payout])
      .mockResolvedValueOnce([record({ currency: null })]);
    prismaMock.lazadaOrder.findMany.mockResolvedValue([{ lazadaOrderId: "order-1", completedAt: new Date("2026-01-01T00:00:00.000Z") }]);

    await reconcileLazadaPayoutStatements({ userId: "user-1", shopId: "shop-1", now: new Date("2026-02-01T00:00:00.000Z") });

    expect(prismaMock.marketplaceAnalyticsReconciliation.create).not.toHaveBeenCalled();
    expect(setMarketplaceFinancialReadiness).not.toHaveBeenCalled();
  });

  it("invalidates automatic readiness when a referenced statement changes on sync", async () => {
    prismaMock.marketplaceAnalyticsReconciliation.updateMany.mockResolvedValue({ count: 1 });

    await invalidateLazadaStatementReconciliations({ userId: "user-1", shopId: "shop-1", statementExternalIds: ["statement-1"] });

    expect(prismaMock.marketplaceAnalyticsReconciliation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ evidenceReference: { in: ["lazada:payout:statement-1"] }, decision: "approved" }),
      data: expect.objectContaining({ decision: "invalidated", residualCategory: "source_changed" }),
    }));
    expect(setMarketplaceFinancialReadiness).toHaveBeenCalledWith(expect.objectContaining({ financeReady: false, reconciliationId: null }));
  });
});
