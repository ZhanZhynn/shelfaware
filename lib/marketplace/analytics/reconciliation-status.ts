import { prisma } from "@/prisma/client";
import { getMarketplaceCapabilities, type CapabilityState } from "./capabilities";
import type { MarketplacePlatform } from "./types";
import { andFinancialRecordWhere, financialRecordWhere, type FinanceFilters } from "@/lib/marketplace/finance-filter";

export type MarketplaceReconciliationStatus = {
  importedLedgerCount: number;
  linkedOrderCount: number;
  unmatchedOrderCount: number;
  invalidLinkedCount: number;
  linkStateCounts: { linked: number; unmatched: number; notApplicable: number; unclassified: number; invalidLinked: number };
  certifiedReconciliationCount: number;
  latestAutomaticReconciliation: {
    decision: string;
    periodEnd: string;
    updatedAt: string;
  } | null;
  recordsProvisional: boolean;
  latestOrdersAndEscrowTaskCompletedAt: string | null;
  financialCoverage: {
    state: "complete" | "partial" | "unavailable";
    latestObservedAt: string | null;
    reason: string | null;
    usableRecords: number;
    excludedUnknownRecords: number;
    numericAmountRecords: number;
    missingAmountRecords: number;
    unverifiedRecords: number;
  };
  freshness: { latestMatchingObservationAt: string | null };
  warnings: string[];
  providerCapabilities: { finance: CapabilityState; settlements: CapabilityState };
};

export function recordsAreProvisional(importedLedgerCount: number, certifiedReconciliationCount: number) {
  return importedLedgerCount > 0 && certifiedReconciliationCount === 0;
}

function reconciliationScope(platform: MarketplacePlatform, shopId: string, now: Date, filters: FinanceFilters) {
  const base = { platform, shopId, decision: "approved", expiresAt: { gt: now } };
  if (!filters.dateRange && !filters.transactionType && !filters.financialQuality && !filters.linkState && !filters.currency) return base;
  if ((filters.dateBasis ?? "occurred") !== "occurred" || !filters.dateRange?.gte || !filters.dateRange.lte) return null;
  return {
    ...base,
    periodStart: { lte: filters.dateRange.gte },
    periodEnd: { gte: filters.dateRange.lte },
    ...(filters.currency ? { currency: filters.currency } : {}),
  };
}

/** Returns reconciliation evidence metadata only; it never totals ledger amounts. */
export async function getMarketplaceReconciliationStatus(platform: MarketplacePlatform, shopId: string, now = new Date(), filters: FinanceFilters = { dateBasis: "occurred" }): Promise<MarketplaceReconciliationStatus> {
  const financialWhere = financialRecordWhere(platform, shopId, filters);
  const certificationWhere = reconciliationScope(platform, shopId, now, filters);
  const [importedLedgerCount, linkedOrderCount, unmatchedOrderCount, notApplicableCount, unclassifiedCount, invalidLinkedCount, numericAmountRecords, usableRecords, verifiedRecords, certifiedReconciliationCount, latestAutomaticReconciliation, latestMatchingObservation, latestOrdersAndEscrowTask, capabilities] = await Promise.all([
    prisma.marketplaceFinancialRecord.count({ where: financialWhere }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { orderLinkState: "linked", orderInternalId: { not: null, isSet: true } }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { orderLinkState: "unmatched" }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { orderLinkState: "not_applicable" }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { OR: [{ orderLinkState: null }, { orderLinkState: { isSet: false } }] }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { orderLinkState: "linked", OR: [{ orderInternalId: null }, { orderInternalId: { isSet: false } }] }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { OR: [{ amountMinor: { not: null } }, { amount: { not: null } }] }) }),
    // Kept for compatibility with existing coverage clients.
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { amountMinor: { not: null } }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(financialWhere, { financialQuality: { in: ["verified", "derived"] } }) }),
    certificationWhere ? prisma.marketplaceAnalyticsReconciliation.count({ where: certificationWhere }) : Promise.resolve(0),
    certificationWhere ? prisma.marketplaceAnalyticsReconciliation.findFirst({
      where: { ...certificationWhere, reviewerId: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { decision: true, periodEnd: true, updatedAt: true },
    }) : Promise.resolve(null),
    prisma.marketplaceFinancialRecord.aggregate({ where: financialWhere, _max: { sourceObservedAt: true } }),
    prisma.marketplaceSyncTask.findFirst({ where: { platform, shopId, stream: "orders_and_escrow", status: "completed" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    getMarketplaceCapabilities(platform, [shopId]),
  ]);
  const missingAmountRecords = importedLedgerCount - numericAmountRecords;
  const unverifiedRecords = importedLedgerCount - verifiedRecords;
  const coverageState = numericAmountRecords === 0 ? "unavailable" : missingAmountRecords > 0 || unverifiedRecords > 0 ? "partial" : "complete";
  const latestMatchingObservationAt = latestMatchingObservation._max.sourceObservedAt?.toISOString() ?? null;
  const warnings = [
    ...(unverifiedRecords > 0 ? ["Some matching financial records are not verified."] : []),
    ...(unclassifiedCount > 0 ? ["Some matching financial records have no link-state classification."] : []),
    ...(invalidLinkedCount > 0 ? ["Some records marked linked do not have a valid internal order ID."] : []),
  ];

  return {
    importedLedgerCount,
    linkedOrderCount,
    unmatchedOrderCount,
    invalidLinkedCount,
    linkStateCounts: { linked: linkedOrderCount, unmatched: unmatchedOrderCount, notApplicable: notApplicableCount, unclassified: unclassifiedCount, invalidLinked: invalidLinkedCount },
    certifiedReconciliationCount,
    latestAutomaticReconciliation: latestAutomaticReconciliation && {
      decision: latestAutomaticReconciliation.decision,
      periodEnd: latestAutomaticReconciliation.periodEnd.toISOString(),
      updatedAt: latestAutomaticReconciliation.updatedAt.toISOString(),
    },
    recordsProvisional: recordsAreProvisional(importedLedgerCount, certifiedReconciliationCount),
    latestOrdersAndEscrowTaskCompletedAt: latestOrdersAndEscrowTask?.completedAt?.toISOString() ?? null,
    financialCoverage: {
      state: coverageState,
      latestObservedAt: latestMatchingObservationAt,
      reason: importedLedgerCount === 0 ? "No matching financial records have been synchronized." : numericAmountRecords === 0 ? "Matching financial records contain no numeric amounts." : coverageState === "partial" ? "Matching financial records are incomplete or unverified." : null,
      usableRecords,
      excludedUnknownRecords: importedLedgerCount - usableRecords,
      numericAmountRecords,
      missingAmountRecords,
      unverifiedRecords,
    },
    freshness: { latestMatchingObservationAt },
    warnings,
    providerCapabilities: { finance: capabilities.finance, settlements: capabilities.settlements },
  };
}
