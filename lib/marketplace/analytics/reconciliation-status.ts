import { prisma } from "@/prisma/client";
import { getMarketplaceCapabilities, type CapabilityState } from "./capabilities";
import type { MarketplacePlatform } from "./types";

export type MarketplaceReconciliationStatus = {
  importedLedgerCount: number;
  linkedOrderCount: number;
  unmatchedOrderCount: number;
  certifiedReconciliationCount: number;
  latestAutomaticReconciliation: {
    decision: string;
    periodEnd: string;
    updatedAt: string;
  } | null;
  recordsProvisional: boolean;
  latestOrdersAndEscrowTaskCompletedAt: string | null;
  financialCoverage: { state: "complete" | "partial" | "unavailable"; latestObservedAt: string | null; reason: string | null };
  providerCapabilities: { finance: CapabilityState; settlements: CapabilityState };
};

export function recordsAreProvisional(importedLedgerCount: number, certifiedReconciliationCount: number) {
  return importedLedgerCount > 0 && certifiedReconciliationCount === 0;
}

/** Returns reconciliation evidence metadata only; it never totals ledger amounts. */
export async function getMarketplaceReconciliationStatus(platform: MarketplacePlatform, shopId: string, now = new Date()): Promise<MarketplaceReconciliationStatus> {
  const certificationWhere = { platform, shopId, decision: "approved", expiresAt: { gt: now } };
  const [importedLedgerCount, linkedOrderCount, unmatchedOrderCount, certifiedReconciliationCount, latestAutomaticReconciliation, latestFinancialRecord, latestOrdersAndEscrowTask, capabilities] = await Promise.all([
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId } }),
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId, orderLinkState: "linked" } }),
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId, orderLinkState: "unmatched" } }),
    prisma.marketplaceAnalyticsReconciliation.count({ where: certificationWhere }),
    prisma.marketplaceAnalyticsReconciliation.findFirst({
      where: { platform, shopId, reviewerId: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { decision: true, periodEnd: true, updatedAt: true },
    }),
    prisma.marketplaceFinancialRecord.findFirst({ where: { platform, shopId }, orderBy: [{ sourceObservedAt: "desc" }, { updatedAt: "desc" }], select: { sourceObservedAt: true, updatedAt: true, amountMinor: true } }),
    prisma.marketplaceSyncTask.findFirst({ where: { platform, shopId, stream: "orders_and_escrow", status: "completed" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    getMarketplaceCapabilities(platform, [shopId]),
  ]);

  return {
    importedLedgerCount,
    linkedOrderCount,
    unmatchedOrderCount,
    certifiedReconciliationCount,
    latestAutomaticReconciliation: latestAutomaticReconciliation && {
      decision: latestAutomaticReconciliation.decision,
      periodEnd: latestAutomaticReconciliation.periodEnd.toISOString(),
      updatedAt: latestAutomaticReconciliation.updatedAt.toISOString(),
    },
    recordsProvisional: recordsAreProvisional(importedLedgerCount, certifiedReconciliationCount),
    latestOrdersAndEscrowTaskCompletedAt: latestOrdersAndEscrowTask?.completedAt?.toISOString() ?? null,
    financialCoverage: {
      state: importedLedgerCount === 0 ? "unavailable" : latestFinancialRecord?.amountMinor ? "partial" : "unavailable",
      latestObservedAt: (latestFinancialRecord?.sourceObservedAt ?? latestFinancialRecord?.updatedAt)?.toISOString() ?? null,
      reason: importedLedgerCount === 0 ? "No financial records have been synchronized." : latestFinancialRecord?.amountMinor ? "Financial values are imported but remain unreconciled." : "Financial records exist but contain no usable amounts.",
    },
    providerCapabilities: { finance: capabilities.finance, settlements: capabilities.settlements },
  };
}
