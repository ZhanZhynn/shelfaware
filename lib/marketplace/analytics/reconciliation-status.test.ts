import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), taskFindFirst: vi.fn(), capabilities: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: {
  marketplaceFinancialRecord: { count: mocks.count, aggregate: mocks.aggregate },
  marketplaceAnalyticsReconciliation: { count: mocks.count, findFirst: mocks.findFirst },
  marketplaceSyncTask: { findFirst: mocks.taskFindFirst },
} }));
vi.mock("./capabilities", () => ({ getMarketplaceCapabilities: mocks.capabilities }));

import { getMarketplaceReconciliationStatus, recordsAreProvisional } from "./reconciliation-status";

describe("marketplace reconciliation status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.capabilities.mockResolvedValue({ finance: "available", settlements: "available" });
    mocks.findFirst.mockResolvedValue(null);
    mocks.taskFindFirst.mockResolvedValue(null);
    mocks.aggregate.mockResolvedValue({ _max: { sourceObservedAt: new Date("2026-01-04T00:00:00.000Z") } });
  });
  it("keeps imported ledger records provisional until a current certification exists", () => {
    expect(recordsAreProvisional(3, 0)).toBe(true);
    expect(recordsAreProvisional(3, 1)).toBe(false);
  });

  it("does not mark an empty ledger as provisional", () => {
    expect(recordsAreProvisional(0, 0)).toBe(false);
  });

  it("partitions every matching link state and aggregates coverage across scoped rows", async () => {
    mocks.count
      .mockResolvedValueOnce(5) // imported
      .mockResolvedValueOnce(1) // valid linked
      .mockResolvedValueOnce(0) // unmatched
      .mockResolvedValueOnce(1) // not applicable
      .mockResolvedValueOnce(2) // unclassified
      .mockResolvedValueOnce(1) // invalid linked
      .mockResolvedValueOnce(2) // numeric, including zero
      .mockResolvedValueOnce(2) // fixed-point usable
      .mockResolvedValueOnce(1) // verified; all other rows are unverified, including missing quality
      .mockResolvedValueOnce(0); // certifications

    const result = await getMarketplaceReconciliationStatus("lazada", "a".repeat(24), new Date("2026-01-05"), {
      dateBasis: "observed", dateRange: { gte: new Date("2026-01-01T00:00:00.000Z") }, financialQuality: "unknown",
    });

    expect(result).toMatchObject({
      linkedOrderCount: 1,
      unmatchedOrderCount: 0,
      invalidLinkedCount: 1,
      linkStateCounts: { linked: 1, unmatched: 0, notApplicable: 1, unclassified: 2, invalidLinked: 1 },
      financialCoverage: { state: "partial", numericAmountRecords: 2, missingAmountRecords: 3, unverifiedRecords: 4 },
      freshness: { latestMatchingObservationAt: "2026-01-04T00:00:00.000Z" },
    });
    expect(result.warnings).toContain("Some matching financial records are not verified.");
    expect(result.warnings).toContain("Some matching financial records have no link-state classification.");
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ orderLinkState: "linked", orderInternalId: { not: null, isSet: true } })]) }) }));
  });

  it("counts only approvals that cover the complete occurred-time window", async () => {
    mocks.count.mockResolvedValue(0);
    const from = new Date("2026-01-10T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");

    await getMarketplaceReconciliationStatus("lazada", "a".repeat(24), new Date("2026-02-01"), {
      dateBasis: "occurred", dateRange: { gte: from, lte: to }, currency: "MYR",
    });

    const coveringApproval = {
      platform: "lazada", shopId: "a".repeat(24), decision: "approved", expiresAt: { gt: new Date("2026-02-01") },
      periodStart: { lte: from }, periodEnd: { gte: to }, currency: "MYR",
    };
    expect(mocks.count).toHaveBeenCalledWith({ where: coveringApproval });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { ...coveringApproval, reviewerId: null } }));
  });

  it("does not infer certification from observed-time or one-sided ranges", async () => {
    mocks.count.mockResolvedValue(0);

    await getMarketplaceReconciliationStatus("lazada", "a".repeat(24), new Date("2026-02-01"), {
      dateBasis: "observed", dateRange: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-31T23:59:59.999Z") },
    });

    expect(mocks.count.mock.calls.some(([input]) => input?.where?.decision === "approved")).toBe(false);
    expect(mocks.findFirst).not.toHaveBeenCalled();

    mocks.count.mockClear();
    await getMarketplaceReconciliationStatus("lazada", "a".repeat(24), new Date("2026-02-01"), {
      dateBasis: "occurred", dateRange: { gte: new Date("2026-01-01T00:00:00.000Z") },
    });

    expect(mocks.count.mock.calls.some(([input]) => input?.where?.decision === "approved")).toBe(false);
  });
});
