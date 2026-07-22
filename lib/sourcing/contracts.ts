/** Normalizes list rows so optimistic/API callers can safely render a new case. */
export function normalizeSourcingListCase<T extends object & { quotes?: unknown[]; orders?: unknown[] }>(item: T) {
  return { ...item, quotes: item.quotes ?? [], orders: item.orders ?? [] };
}
