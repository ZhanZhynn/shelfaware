const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELLED_BY_SELLER", "CANCELLED_BY_BUYER", "IN_CANCEL"]);
const UNPAID_STATUSES = new Set(["UNPAID"]);

export function isCancelledStatus(status: string | null | undefined) {
  if (!status) return false;
  return CANCELLED_STATUSES.has(status.toUpperCase());
}

export function isUnpaidStatus(status: string | null | undefined) {
  if (!status) return false;
  return UNPAID_STATUSES.has(status.toUpperCase());
}
