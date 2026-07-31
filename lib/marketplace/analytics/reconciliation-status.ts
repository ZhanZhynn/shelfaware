import { prisma } from "@/prisma/client";
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
};

export function recordsAreProvisional(importedLedgerCount: number, certifiedReconciliationCount: number) {
  return importedLedgerCount > 0 && certifiedReconciliationCount === 0;
}

/** Returns reconciliation evidence metadata only; it never totals ledger amounts. */
export async function getMarketplaceReconciliationStatus(platform: MarketplacePlatform, shopId: string, now = new Date()): Promise<MarketplaceReconciliationStatus> {
  const certificationWhere = { platform, shopId, decision: "approved", expiresAt: { gt: now } };
  const [importedLedgerCount, linkedOrderCount, unmatchedOrderCount, certifiedReconciliationCount, latestAutomaticReconciliation] = await Promise.all([
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId } }),
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId, orderLinkState: "linked" } }),
    prisma.marketplaceFinancialRecord.count({ where: { platform, shopId, orderLinkState: "unmatched" } }),
    prisma.marketplaceAnalyticsReconciliation.count({ where: certificationWhere }),
    prisma.marketplaceAnalyticsReconciliation.findFirst({
      where: { platform, shopId, reviewerId: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { decision: true, periodEnd: true, updatedAt: true },
    }),
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
  };
}
