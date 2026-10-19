import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/prisma/client", () => ({ prisma: { shopeeReturn: { findMany } } }));

import { getShopeeRefundEvidence } from "./refund-evidence";

beforeEach(() => vi.resetAllMocks());

describe("Shopee refund evidence", () => {
  it("scopes observations to each shop/order pair and never calls them settled refunds", async () => {
    findMany.mockResolvedValue([
      { shopId: "shop-a", orderSn: "order-a", status: "COMPLETED", refundAmount: 23.65, currency: "MYR", sourceObservedAt: new Date("2026-09-01T00:00:00Z") },
      { shopId: "shop-b", orderSn: "order-b", status: "ACCEPTED", refundAmount: 14.56, currency: "MYR", sourceObservedAt: null },
    ]);
    const evidence = await getShopeeRefundEvidence([
      { shopId: "shop-a", shopeeOrderId: "order-a", currency: "MYR" },
      { shopId: "shop-b", shopeeOrderId: "order-b", currency: "MYR" },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { shopId: "shop-a", orderSn: { in: ["order-a"] } }, { shopId: "shop-b", orderSn: { in: ["order-b"] } },
    ] } }));
    expect(evidence).toMatchObject({ state: "observed_unverified", returnRequestCount: 2, observedRequestAmount: 38.21, settledRefundAmount: null, historyCompleteness: "unknown" });
  });

  it("keeps absent, mixed-currency, and missing amounts unknown", async () => {
    findMany.mockResolvedValue([]);
    expect(await getShopeeRefundEvidence([{ shopId: "a", shopeeOrderId: "a", currency: "MYR" }])).toMatchObject({ state: "not_observed", observedRequestAmount: null, settledRefundAmount: null });
    findMany.mockResolvedValue([
      { shopId: "a", orderSn: "a", status: "COMPLETED", refundAmount: null, currency: "MYR", sourceObservedAt: null },
      { shopId: "a", orderSn: "a", status: "REQUESTED", refundAmount: 0, currency: "SGD", sourceObservedAt: null },
    ]);
    expect(await getShopeeRefundEvidence([{ shopId: "a", shopeeOrderId: "a", currency: "MYR" }])).toMatchObject({ observedRequestAmount: null, knownRequestAmountCount: 1, missingRequestAmountCount: 1, currency: null });
    findMany.mockClear();
    expect(await getShopeeRefundEvidence([])).toMatchObject({ state: "not_observed", observedRequestAmount: null });
    expect(findMany).not.toHaveBeenCalled();
  });
});
