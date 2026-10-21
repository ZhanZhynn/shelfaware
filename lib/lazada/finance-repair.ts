import { sanitizeMarketplaceRawPayload } from "@/lib/marketplace/json";
import { lazadaFinanceIdentity, lazadaFinanceLegacyIdentity, lazadaFinanceSameComponent } from "./finance-identity";
import { LazadaProviderError } from "./provider-error";

export type StoredLazadaFinanceRow = {
  id: string;
  externalId: string;
  shopId: string;
  feeType?: string | null;
  feeName?: string | null;
  orderExternalId?: string | null;
  orderInternalId?: string | null;
  itemExternalId?: string | null;
  amountMinor?: string | null;
  amountScale: number;
  currency?: string | null;
  occurredAt?: Date | null;
  statementExternalId?: string | null;
  financialQuality: string;
  updatedAt: Date;
  sourceObservedAt?: Date | null;
  rawPayload?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function postingSource(row: StoredLazadaFinanceRow, incoming: Record<string, unknown>) {
  const raw = object(row.rawPayload);
  const hasEnvelope = raw.transaction_number !== undefined && raw.transaction_number !== null;
  return {
    transaction_number: raw.transaction_number ?? incoming.transaction_number,
    fee_type: row.feeType ?? raw.fee_type,
    fee_name: row.feeName ?? raw.fee_name,
    order_no: row.orderExternalId ?? raw.order_no,
    // Resolved attribution can be enriched later. It must not rewrite the
    // original provider tuple when the source omitted orderItem_no.
    orderItem_no: hasEnvelope ? raw.orderItem_no : row.itemExternalId,
  };
}

function matchesComponent(row: StoredLazadaFinanceRow, incoming: Record<string, unknown>) {
  const source = postingSource(row, incoming);
  const identity = lazadaFinanceIdentity(incoming);
  const validAlias = row.externalId === identity.transactionNumber
    || (row.externalId.startsWith("finance:v2:") && row.externalId === lazadaFinanceLegacyIdentity(source))
    || row.externalId === lazadaFinanceIdentity(source).externalId;
  return validAlias && lazadaFinanceSameComponent(source, incoming);
}

function fixed(row: StoredLazadaFinanceRow): { minor: bigint; scale: number } | null {
  if (typeof row.amountMinor !== "string" || !/^-?\d+$/.test(row.amountMinor)
    || !Number.isInteger(row.amountScale) || row.amountScale! < 0 || row.amountScale! > 12) return null;
  return { minor: BigInt(row.amountMinor), scale: row.amountScale! };
}

function sameMoney(left: StoredLazadaFinanceRow, right: StoredLazadaFinanceRow) {
  const a = fixed(left), b = fixed(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.minor * 10n ** BigInt(scale - a.scale) === b.minor * 10n ** BigInt(scale - b.scale);
}

function iso(value: Date | null | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function assertDuplicate(left: StoredLazadaFinanceRow, right: StoredLazadaFinanceRow) {
  const fields: string[] = [];
  if (!sameMoney(left, right)) fields.push("amountMinor");
  if ((left.currency ?? null) !== (right.currency ?? null)) fields.push("currency");
  if (!iso(left.occurredAt) || iso(left.occurredAt) !== iso(right.occurredAt)) fields.push("occurredAt");
  if ((left.statementExternalId ?? null) !== (right.statementExternalId ?? null)) fields.push("statementExternalId");
  if (left.orderInternalId && right.orderInternalId && left.orderInternalId !== right.orderInternalId) fields.push("orderInternalId");
  for (const key of ["VAT_in_amount", "WHT_amount", "WHT_included_in_amount"]) {
    if (JSON.stringify(object(left.rawPayload)[key] ?? null) !== JSON.stringify(object(right.rawPayload)[key] ?? null)) fields.push(key);
  }
  if (!["unknown", "legacy-unverified"].includes(left.financialQuality ?? "")
    || !["unknown", "legacy-unverified"].includes(right.financialQuality ?? "")) fields.push("financialQuality");
  if (fields.length) throw new LazadaProviderError("INCONSISTENT_FINANCE_ALIAS_FACTS", 502, undefined, fields);
}

/** Consider every alias. An unrelated raw transaction-ID row must never shadow
 * the matching v2 component (the cause of the 21 duplicate affiliate charges). */
export function planLazadaFinanceWrite(shopId: string, incoming: Record<string, unknown>, current: StoredLazadaFinanceRow | null, aliases: readonly StoredLazadaFinanceRow[]) {
  const identity = lazadaFinanceIdentity(incoming);
  if ([...(current ? [current] : []), ...aliases].some((row) => row.shopId !== shopId)) throw new LazadaProviderError("INCONSISTENT_FINANCE_SCOPE", 502);
  if (current && !matchesComponent(current, incoming)) throw new LazadaProviderError("INCONSISTENT_CANONICAL_FINANCE_COMPONENT", 502);
  const matching = [...new Map(aliases.filter((row) => row.id !== current?.id && matchesComponent(row, incoming)).map((row) => [row.id, row])).values()];
  const keeper = current ?? matching.slice().sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  const duplicates = matching.filter((row) => row.id !== keeper?.id);
  if (keeper) for (const duplicate of duplicates) assertDuplicate(keeper, duplicate);
  return { externalId: identity.externalId, keeper, duplicates, migrated: Boolean(keeper && keeper.externalId !== identity.externalId) };
}

/** Deleted entries are redundant, unverified database observations, not separate
 * monetary postings. Keep their source/provenance audit on the surviving record. */
export function lazadaFinanceAuditPayload(source: unknown, keeper: StoredLazadaFinanceRow | null, duplicates: readonly StoredLazadaFinanceRow[]) {
  const payload = { ...object(source) };
  delete payload.shelfaware_alias_merges;
  const audit = new Map<string, unknown>();
  for (const row of [...(keeper ? [keeper] : []), ...duplicates]) {
    const previous = object(row.rawPayload).shelfaware_alias_merges;
    if (Array.isArray(previous)) for (const entry of previous) {
      const value = object(entry);
      if (typeof value.id === "string") audit.set(value.id, value);
    }
  }
  for (const row of duplicates) {
    const raw = { ...object(row.rawPayload) };
    delete raw.shelfaware_alias_merges;
    audit.set(row.id, {
      id: row.id, externalId: row.externalId, amountMinor: row.amountMinor, amountScale: row.amountScale,
      currency: row.currency ?? null, occurredAt: iso(row.occurredAt), statementExternalId: row.statementExternalId ?? null,
      sourceObservedAt: iso(row.sourceObservedAt), rawPayload: raw,
    });
  }
  return sanitizeMarketplaceRawPayload({ ...payload, ...(audit.size ? { shelfaware_alias_merges: [...audit.values()] } : {}) });
}
