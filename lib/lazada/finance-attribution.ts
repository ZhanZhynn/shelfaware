type AttributionSource = {
  itemExternalId?: unknown;
  sourceReference?: unknown;
  sourceTransactionNumber?: unknown;
  rawPayload?: unknown;
};

function identifier(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

/** Alternative provider references are attribution evidence only after matching
 * a known line in the same shop/order. They never change the posting identity. */
export function resolveLazadaFinanceLine(shopId: string, orderNumber: string | null, row: AttributionSource, knownLine: (shopId: string, orderNumber: string, lineNumber: string) => boolean) {
  const raw = row.rawPayload && typeof row.rawPayload === "object" && !Array.isArray(row.rawPayload) ? row.rawPayload as Record<string, unknown> : {};
  const candidates = [
    { id: identifier(row.itemExternalId ?? raw.orderItem_no), basis: "provider_orderItem_no" },
    { id: identifier(row.sourceReference ?? raw.reference), basis: "provider_reference" },
    { id: identifier(row.sourceTransactionNumber ?? raw.transaction_number), basis: "provider_transaction_number" },
  ];
  if (orderNumber) for (const candidate of candidates) {
    if (candidate.id && knownLine(shopId, orderNumber, candidate.id)) return { externalLineId: candidate.id, basis: candidate.basis };
  }
  return { externalLineId: null, basis: candidates[0]!.id ? "unverified_provider_orderItem_no" : "unavailable" };
}
