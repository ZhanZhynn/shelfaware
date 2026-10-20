const statuses: Record<string, string> = {
  pending: "pending", confirmed: "confirmed", packed: "processing", ready_to_ship: "processing",
  processing: "processing", shipped: "shipped", delivered: "delivered", canceled: "cancelled", cancelled: "cancelled",
  returned: "returned", package_returned: "returned", shipped_back_success: "returned", failed: "failed",
};

export function normalizeLazadaStatus(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[ -]+/g, "_") : "";
  return statuses[raw] ?? "unknown";
}

export function lazadaOrderStatus(sourceStatuses: unknown): string {
  const values = Array.isArray(sourceStatuses) ? [...new Set(sourceStatuses.map(normalizeLazadaStatus))] : [];
  return values.length === 1 ? values[0]! : values.length > 1 ? "mixed" : "unknown";
}

export function lazadaRevenue(status: string, amount: number | null) {
  const eligible = ["confirmed", "processing", "shipped", "delivered"].includes(normalizeLazadaStatus(status));
  return { revenueEligible: amount !== null && eligible, revenueAmount: amount === null ? null : eligible ? amount : 0, revenueBasis: "gross_merchandise" };
}

export function lazadaPaymentStatus(status: string) {
  if (status === "pending") return "unpaid";
  if (["confirmed", "processing", "shipped", "delivered"].includes(status)) return "paid";
  // A cancellation/return lifecycle event does not prove a settled refund.
  return "unknown";
}
