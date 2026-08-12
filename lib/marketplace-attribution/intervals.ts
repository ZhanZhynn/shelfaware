export type EffectiveInterval = { effectiveFrom: Date; effectiveTo: Date | null };

export function intervalsOverlap(left: EffectiveInterval, right: EffectiveInterval) {
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.effectiveFrom.getTime() <= rightEnd && right.effectiveFrom.getTime() <= leftEnd;
}

export function normalizeSku(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeCatalogCode(value: string) {
  const code = normalizeSku(value);
  if (!code) throw new Error("A code must contain at least one letter or number.");
  return code;
}
