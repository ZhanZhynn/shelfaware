export type FixedPointAmount = {
  amountMinor: bigint | string;
  amountScale: number;
  currency: string | null | undefined;
};

export type FixedPointTotal = {
  amountMinor: bigint;
  amountScale: number;
  currency: string;
};

export type FixedPointSum =
  | { ok: true; total: FixedPointTotal }
  | { ok: false; reason: "no_records" | "invalid_amount" | "invalid_currency" | "mixed_currency" | "mixed_scale" };

/** A provider statement must be explicitly identified as final before it can reconcile a payout. */
export type ProviderStatement = FixedPointAmount & {
  final: boolean;
  reference?: string;
};

export type ReconciliationInput = {
  completionDate: Date;
  records: readonly FixedPointAmount[];
  finalStatement?: ProviderStatement | null;
  now?: Date;
};

export type ReconciliationResult = {
  status: "provisional" | "mature" | "unmatched";
  approvalEligible: boolean;
  maturityDate: Date;
  isMature: boolean;
  expected: FixedPointTotal | null;
  actual: FixedPointTotal | null;
  deltaMinor: bigint | null;
  comparison: "unavailable" | "exact" | "within_one_minor_unit" | "outside_tolerance";
  reason: "not_mature" | "final_statement_required" | "incompatible_records" | "incompatible_statement" | "outside_tolerance" | null;
};

/** The maturity period is 30 calendar days after the completion timestamp, in UTC. */
export function marketplaceMaturityDate(completionDate: Date): Date {
  const maturityDate = new Date(completionDate);
  maturityDate.setUTCDate(maturityDate.getUTCDate() + 30);
  return maturityDate;
}

/**
 * Sums minor units without conversion. A total is only meaningful when every row
 * has the same non-empty currency and scale.
 */
export function sumFixedPointRecords(records: readonly FixedPointAmount[]): FixedPointSum {
  if (records.length === 0) return { ok: false, reason: "no_records" };

  let amountMinor = 0n;
  let currency: string | null = null;
  let amountScale: number | null = null;
  for (const record of records) {
    const minor = parseMinor(record.amountMinor);
    if (minor === null) return { ok: false, reason: "invalid_amount" };
    if (!isValidCurrency(record.currency)) return { ok: false, reason: "invalid_currency" };
    if (!Number.isSafeInteger(record.amountScale) || record.amountScale < 0) return { ok: false, reason: "mixed_scale" };
    if (currency !== null && currency !== record.currency) return { ok: false, reason: "mixed_currency" };
    if (amountScale !== null && amountScale !== record.amountScale) return { ok: false, reason: "mixed_scale" };
    amountMinor += minor;
    currency = record.currency;
    amountScale = record.amountScale;
  }
  return { ok: true, total: { amountMinor, currency: currency!, amountScale: amountScale! } };
}

/**
 * Reconciliation is informational until a caller supplies a final provider
 * statement. This function never approves or persists anything on its own.
 */
export function reconcileMarketplaceFinancialRecords(input: ReconciliationInput): ReconciliationResult {
  const maturityDate = marketplaceMaturityDate(input.completionDate);
  const isMature = (input.now ?? new Date()).getTime() >= maturityDate.getTime();
  const expected = sumFixedPointRecords(input.records);
  const base = { maturityDate, isMature, expected: expected.ok ? expected.total : null };

  if (!expected.ok) {
    return { ...base, status: "unmatched", approvalEligible: false, actual: null, deltaMinor: null, comparison: "unavailable", reason: "incompatible_records" };
  }
  if (!input.finalStatement || input.finalStatement.final !== true) {
    return { ...base, status: "provisional", approvalEligible: false, actual: null, deltaMinor: null, comparison: "unavailable", reason: "final_statement_required" };
  }

  const actual = sumFixedPointRecords([input.finalStatement]);
  if (!actual.ok || actual.total.currency !== expected.total.currency || actual.total.amountScale !== expected.total.amountScale) {
    return { ...base, status: "unmatched", approvalEligible: false, actual: actual.ok ? actual.total : null, deltaMinor: null, comparison: "unavailable", reason: "incompatible_statement" };
  }

  const deltaMinor = actual.total.amountMinor - expected.total.amountMinor;
  const comparison = deltaMinor === 0n ? "exact" : absolute(deltaMinor) === 1n ? "within_one_minor_unit" : "outside_tolerance";
  if (comparison === "outside_tolerance") {
    return { ...base, status: "unmatched", approvalEligible: false, actual: actual.total, deltaMinor, comparison, reason: "outside_tolerance" };
  }
  if (!isMature) {
    return { ...base, status: "provisional", approvalEligible: false, actual: actual.total, deltaMinor, comparison, reason: "not_mature" };
  }
  return { ...base, status: "mature", approvalEligible: true, actual: actual.total, deltaMinor, comparison, reason: null };
}

function parseMinor(value: bigint | string): bigint | null {
  if (typeof value === "bigint") return value;
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

function isValidCurrency(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
