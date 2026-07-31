export const financialQualities = ["verified", "derived", "legacy-unverified", "unknown"] as const;
export type FinancialQuality = (typeof financialQualities)[number];

export interface ProvenancedValue<T> {
  value: T | null;
  quality: FinancialQuality;
  unknownReason?: string;
  source?: string;
  observedAt?: Date;
}

export function isCertifiedQuality(quality: FinancialQuality): boolean {
  return quality === "verified" || quality === "derived";
}

/** Parses only an explicitly supplied finite source value; absence is never zero. */
export function parseSourceNumber(value: unknown, source = "source"): ProvenancedValue<number> {
  if (value === undefined || value === null || value === "") return { value: null, quality: "unknown", unknownReason: "source_field_absent", source };
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return { value: null, quality: "unknown", unknownReason: "source_value_malformed", source };
  // Parseability establishes only that the provider sent a number. Certification
  // requires separately approved source-field evidence and reconciliation.
  return { value: number, quality: "unknown", unknownReason: "source_observed_unverified", source, observedAt: new Date() };
}
