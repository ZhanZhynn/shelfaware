/** Normalizes list rows so optimistic/API callers can safely render a new case. */
export function normalizeSourcingListCase<
  T extends object & {
    quotes?: unknown[];
    orders?: unknown[];
    attachments?: { url: string; fileName?: string | null }[];
    photoUrls?: unknown;
  },
>(item: T) {
  const { attachments, ...sourcingCase } = item;
  const photoUrl = Array.isArray(item.photoUrls) && typeof item.photoUrls[0] === "string"
    ? item.photoUrls[0]
    : null;
  return {
    ...sourcingCase,
    quotes: item.quotes ?? [],
    orders: item.orders ?? [],
    thumbnail: attachments?.[0] ?? (photoUrl ? { url: photoUrl, fileName: null } : null),
  };
}
