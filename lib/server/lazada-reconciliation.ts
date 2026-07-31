import { createHash } from "crypto";
import { prisma } from "@/prisma/client";
import { ensureMarketplaceAnalyticsConnection, setMarketplaceFinancialReadiness } from "@/lib/marketplace/analytics/capabilities";
import { reconcileMarketplaceFinancialRecords, type ReconciliationResult } from "@/lib/marketplace/analytics/reconciliation";

type FinancialRecord = {
  id: string;
  externalId: string;
  statementExternalId: string | null;
  orderExternalId: string | null;
  transactionType: string | null;
  feeType: string | null;
  amountMinor: string | null;
  amountScale: number;
  currency: string | null;
  occurredAt: Date | null;
};

type LazadaOrderCompletion = {
  lazadaOrderId: string;
  completedAt: Date | null;
};

export type LazadaPayoutAssessment = {
  eligible: boolean;
  reason: "no_transactions" | "missing_order_completion" | "incompatible_records" | "final_statement_required" | "incompatible_statement" | "outside_tolerance" | "not_mature" | null;
  reconciliation: ReconciliationResult | null;
};

/**
 * This only evaluates statement references explicitly supplied by Lazada. It does
 * not infer a statement from dates, orders, or transaction identifiers.
 */
export function assessLazadaPayoutStatement(input: {
  payout: FinancialRecord;
  transactions: readonly FinancialRecord[];
  orders: readonly LazadaOrderCompletion[];
  now?: Date;
}): LazadaPayoutAssessment {
  if (input.transactions.length === 0) {
    return { eligible: false, reason: "no_transactions", reconciliation: null };
  }

  if (input.transactions.some((record) => !record.orderExternalId)) {
    return { eligible: false, reason: "missing_order_completion", reconciliation: null };
  }
  const orderIds = [...new Set(input.transactions.map((record) => record.orderExternalId).filter((id): id is string => id !== null))];
  const completions = new Map(input.orders.map((order) => [order.lazadaOrderId, order.completedAt]));
  const completionDates = orderIds.map((id) => completions.get(id));
  if (completionDates.some((date) => !date)) {
    return { eligible: false, reason: "missing_order_completion", reconciliation: null };
  }

  // All linked orders must mature, so compare against the latest completion date.
  const completionDate = new Date(Math.max(...completionDates.map((date) => date!.getTime())));
  const reconciliation = reconcileMarketplaceFinancialRecords({
    completionDate,
    records: input.transactions.map((record) => ({ amountMinor: record.amountMinor ?? "", amountScale: record.amountScale, currency: record.currency })),
    finalStatement: {
      amountMinor: input.payout.amountMinor ?? "",
      amountScale: input.payout.amountScale,
      currency: input.payout.currency,
      final: input.payout.feeType === "payout_paid",
      reference: input.payout.statementExternalId ?? undefined,
    },
    now: input.now,
  });
  return { eligible: reconciliation.approvalEligible, reason: reconciliation.reason, reconciliation };
}

export async function reconcileLazadaPayoutStatements(input: { userId: string; shopId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const payouts = await prisma.marketplaceFinancialRecord.findMany({
    where: { platform: "lazada", shopId: input.shopId, transactionType: "payout_statement", feeType: "payout_paid", statementExternalId: { not: null } },
    select: financialRecordSelection,
  });
  let eligible = 0;
  let persisted = 0;

  for (const payout of payouts) {
    const statementExternalId = payout.statementExternalId;
    if (!statementExternalId) continue;
    const transactions = await prisma.marketplaceFinancialRecord.findMany({
      where: { platform: "lazada", shopId: input.shopId, statementExternalId, NOT: { transactionType: "payout_statement" } },
      select: financialRecordSelection,
    });
    const orderIds = [...new Set(transactions.map((record) => record.orderExternalId).filter((id): id is string => Boolean(id)))];
    const orders = orderIds.length
      ? await prisma.lazadaOrder.findMany({ where: { shopId: input.shopId, lazadaOrderId: { in: orderIds } }, select: { lazadaOrderId: true, completedAt: true } })
      : [];
    const assessment = assessLazadaPayoutStatement({ payout, transactions, orders, now });
    if (!assessment.eligible || !assessment.reconciliation?.expected || !assessment.reconciliation.actual) continue;

    eligible++;
    const evidenceReference = payoutEvidenceReference(statementExternalId);
    const connection = await ensureMarketplaceAnalyticsConnection({ userId: input.userId, platform: "lazada", shopId: input.shopId });
    const evidenceHash = reconciliationEvidenceHash({ payout, transactions, orders });
    const data = {
      userId: input.userId,
      platform: "lazada",
      shopId: input.shopId,
      connectionId: connection.id,
      periodStart: earliestCompletion(orders),
      periodEnd: latestCompletion(orders),
      calculationVersion: "lazada-payout-v1",
      evidenceHash,
      evidenceReference,
      currency: assessment.reconciliation.expected.currency,
      expectedMinor: assessment.reconciliation.expected.amountMinor.toString(),
      actualMinor: assessment.reconciliation.actual.amountMinor.toString(),
      deltaMinor: assessment.reconciliation.deltaMinor?.toString() ?? null,
      scale: assessment.reconciliation.expected.amountScale,
      residualCategory: assessment.reconciliation.comparison,
      decision: "approved",
      // Re-evaluation is explicit; invalidation happens immediately on source changes.
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    };
    const existing = await prisma.marketplaceAnalyticsReconciliation.findFirst({ where: { platform: "lazada", shopId: input.shopId, evidenceReference }, select: { id: true } });
    const reconciliation = existing
      ? await prisma.marketplaceAnalyticsReconciliation.update({ where: { id: existing.id }, data })
      : await prisma.marketplaceAnalyticsReconciliation.create({ data });
    await setMarketplaceFinancialReadiness({ userId: input.userId, platform: "lazada", shopId: input.shopId, financeReady: true, reconciledAt: now, reconciliationId: reconciliation.id, detail: `Automatically reconciled paid Lazada statement ${statementExternalId}` });
    persisted++;
  }

  return { paidStatements: payouts.length, eligible, persisted };
}

/** Invalidate only automated evidence tied to the changed documented statement reference. */
export async function invalidateLazadaStatementReconciliations(input: { userId: string; shopId: string; statementExternalIds: readonly (string | null | undefined)[] }) {
  const references = [...new Set(input.statementExternalIds.filter((id): id is string => typeof id === "string" && id.length > 0).map(payoutEvidenceReference))];
  if (references.length === 0) return;
  const invalidated = await prisma.marketplaceAnalyticsReconciliation.updateMany({
    where: { platform: "lazada", shopId: input.shopId, evidenceReference: { in: references }, calculationVersion: "lazada-payout-v1", decision: "approved" },
    data: { decision: "invalidated", residualCategory: "source_changed", expiresAt: new Date() },
  });
  if (invalidated.count > 0) {
    await setMarketplaceFinancialReadiness({ userId: input.userId, platform: "lazada", shopId: input.shopId, financeReady: false, reconciliationId: null, detail: "A Lazada payout statement changed and requires reconciliation again" });
  }
}

export const financialRecordSelection = {
  id: true,
  externalId: true,
  statementExternalId: true,
  orderExternalId: true,
  transactionType: true,
  feeType: true,
  amountMinor: true,
  amountScale: true,
  currency: true,
  occurredAt: true,
} as const;

function payoutEvidenceReference(statementExternalId: string) {
  return `lazada:payout:${statementExternalId}`;
}

function earliestCompletion(orders: readonly LazadaOrderCompletion[]) {
  return new Date(Math.min(...orders.map((order) => order.completedAt!.getTime())));
}

function latestCompletion(orders: readonly LazadaOrderCompletion[]) {
  return new Date(Math.max(...orders.map((order) => order.completedAt!.getTime())));
}

function reconciliationEvidenceHash(input: { payout: FinancialRecord; transactions: readonly FinancialRecord[]; orders: readonly LazadaOrderCompletion[] }) {
  // Evidence is intentionally limited to stable identifiers and financial metadata.
  return createHash("sha256").update(JSON.stringify({
    statementExternalId: input.payout.statementExternalId,
    payout: financialMetadata(input.payout),
    transactions: input.transactions.map(financialMetadata).sort((left, right) => left.externalId.localeCompare(right.externalId)),
    orders: input.orders.map((order) => ({ lazadaOrderId: order.lazadaOrderId, completedAt: order.completedAt?.toISOString() ?? null })).sort((left, right) => left.lazadaOrderId.localeCompare(right.lazadaOrderId)),
  })).digest("hex");
}

function financialMetadata(record: FinancialRecord) {
  return {
    externalId: record.externalId,
    orderExternalId: record.orderExternalId,
    amountMinor: record.amountMinor,
    amountScale: record.amountScale,
    currency: record.currency,
    occurredAt: record.occurredAt?.toISOString() ?? null,
  };
}
