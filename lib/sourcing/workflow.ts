export function nextQuoteRevision(
  latest?: { revision: number; status: string } | null,
) {
  return latest?.status === "draft"
    ? latest.revision
    : (latest?.revision ?? 0) + 1;
}

/** Existing quotes predate offer groups, so their own ID is their stable group key. */
export function quoteGroupKey(quote: {
  id: string;
  quoteGroupId?: string | null;
}) {
  return quote.quoteGroupId ?? quote.id;
}

export function canEditQuote(
  role: string,
  globalAdmin: boolean,
  assignedToId: string | null,
  userId: string,
  stage: string,
) {
  return (
    (["draft", "sourcing", "changes_requested"].includes(stage) || stage === "quoted") &&
    (globalAdmin || (role === "sourcer" && assignedToId === userId))
  );
}
