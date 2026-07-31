type OperationalEvent = "capability_checked" | "backfill_requested" | "backfill_cancelled" | "reconciliation_decision" | "cache_invalidation_failed";

/** Deliberately contains no shop IDs, external IDs, payloads, or credentials. */
export function marketplaceOperationalEvent(event: OperationalEvent, outcome: "success" | "blocked" | "failure") {
  return { namespace: "marketplace_analytics", event, outcome } as const;
}
