import { prisma } from "@/prisma/client";

/** Return requests are evidence of a possible refund, not verified settlement postings. */
export async function getShopeeRefundEvidence(orders: Array<{ shopId: string; shopeeOrderId: string; currency: string | null }>) {
  const byShop = new Map<string, Set<string>>();
  for (const order of orders) {
    const ids = byShop.get(order.shopId) ?? new Set<string>();
    ids.add(order.shopeeOrderId);
    byShop.set(order.shopId, ids);
  }
  const returns = byShop.size ? await prisma.shopeeReturn.findMany({
    where: { OR: [...byShop].map(([shopId, ids]) => ({ shopId, orderSn: { in: [...ids] } })) },
    select: { shopId: true, orderSn: true, status: true, refundAmount: true, currency: true, sourceObservedAt: true },
  }) : [];
  const currencies = [...new Set(returns.map((item) => item.currency))];
  const amounts = returns.map((item) => item.refundAmount);
  const knownAmounts = amounts.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const observedTimes = returns.flatMap((item) => item.sourceObservedAt ? [item.sourceObservedAt.getTime()] : []);
  return {
    state: returns.length ? "observed_unverified" as const : "not_observed" as const,
    returnRequestCount: returns.length,
    ordersWithReturnRequests: new Set(returns.map((item) => `${item.shopId}:${item.orderSn}`)).size,
    acceptedOrCompletedRequestCount: returns.filter((item) => ["ACCEPTED", "COMPLETED"].includes(item.status.toUpperCase())).length,
    knownRequestAmountCount: knownAmounts.length,
    missingRequestAmountCount: returns.length - knownAmounts.length,
    observedRequestAmount: returns.length && knownAmounts.length === returns.length && currencies.length === 1 && currencies[0]
      ? Math.round(knownAmounts.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null,
    currency: currencies.length === 1 ? currencies[0] : null,
    amountBasis: "return_request_source_value" as const,
    settledRefundAmount: null,
    latestObservedAt: observedTimes.length ? new Date(observedTimes.reduce((latest, value) => Math.max(latest, value))).toISOString() : null,
    historyCompleteness: "unknown" as const,
    warning: "Return requests do not establish final refund postings. Gross order values are not refund-adjusted net sales.",
  };
}
