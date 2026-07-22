export function nextQuoteRevision(latest?: { revision: number; status: string } | null) {
  return latest?.status === "draft" ? latest.revision : (latest?.revision ?? 0) + 1;
}

export function canEditQuote(role: string, globalAdmin: boolean, assignedToId: string | null, userId: string, stage: string) {
  return ["draft", "sourcing", "changes_requested"].includes(stage) && (globalAdmin || role === "admin" || (role === "sourcer" && assignedToId === userId));
}
