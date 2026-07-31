import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, sdk, getShopeeSDK, setMarketplaceCapability } = vi.hoisted(() => {
  const sdk = {
    order: {
      getOrderList: vi.fn(),
      getOrdersDetail: vi.fn(),
      searchPackageList: vi.fn(),
    },
    payment: { getEscrowDetailBatch: vi.fn(), getPayoutInfo: vi.fn() },
  };
  const prismaMock = {
    shopeeShop: { findFirst: vi.fn(), update: vi.fn() },
    shopeeSyncLog: { create: vi.fn(), update: vi.fn() },
    shopeeProductVariant: { findMany: vi.fn() },
    shopeeOrder: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    shopeeOrderItem: { deleteMany: vi.fn(), create: vi.fn() },
    marketplaceFinancialRecord: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  return { prismaMock, sdk, getShopeeSDK: vi.fn(), setMarketplaceCapability: vi.fn() };
});

vi.mock("./server", () => ({ getShopeeSDK }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncShopeeOrders, syncShopeePayoutStatements } from "./sync";

function configureOrderSync() {
  prismaMock.shopeeShop.findFirst.mockResolvedValue({ id: "shop-record", shopId: 123 });
  prismaMock.shopeeSyncLog.create.mockResolvedValue({ id: "sync-log" });
  prismaMock.shopeeProductVariant.findMany.mockResolvedValue([]);
  prismaMock.shopeeOrder.findFirst.mockResolvedValue({ id: "order-record" });
  prismaMock.shopeeOrder.update.mockResolvedValue({ id: "order-record" });
  prismaMock.shopeeSyncLog.update.mockResolvedValue({});
  prismaMock.shopeeShop.update.mockResolvedValue({});
  prismaMock.marketplaceFinancialRecord.upsert.mockResolvedValue({});
  prismaMock.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
  setMarketplaceCapability.mockResolvedValue({});
  sdk.order.getOrderList.mockResolvedValue({
    response: { order_list: [{ order_sn: "ORDER-1", order_status: "COMPLETED" }], more: false, next_cursor: "" },
  });
  sdk.order.getOrdersDetail.mockResolvedValue({
    response: {
      order_list: [{
        order_sn: "ORDER-1",
        order_status: "COMPLETED",
        create_time: 1_700_000_000,
        currency: "MYR",
        item_list: [],
      }],
    },
  });
  sdk.order.searchPackageList.mockResolvedValue({
    response: { package_list: [], more: false, next_cursor: "" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getShopeeSDK.mockReturnValue(sdk);
  configureOrderSync();
});

describe("Shopee final payout sync", () => {
  const finalPayout = {
    encrypted_payout_id: "11796795500890875355",
    from_currency: "SGD",
    payout_currency: "USD",
    from_amount: 1769.01,
    payout_amount: 1769.01,
    exchange_rate: "1",
    payout_time: 1_691_638_015,
    payee_id: "private-account",
  };

  it("upserts final payouts under payout-specific IDs and then observes settlements", async () => {
    sdk.payment.getPayoutInfo.mockResolvedValue({
      response: { payout_list: [finalPayout], more: false, next_cursor: "" },
    });
    prismaMock.marketplaceFinancialRecord.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-payout" });

    const first = await syncShopeePayoutStatements(123, "user-record");
    const second = await syncShopeePayoutStatements(123, "user-record");

    expect(first).toMatchObject({ synced: 1, created: 1, updated: 0, errors: [] });
    expect(second).toMatchObject({ synced: 1, created: 0, updated: 1, errors: [] });
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        platform_shopId_externalId: {
          platform: "shopee",
          shopId: "shop-record",
          externalId: "payout:11796795500890875355",
        },
      },
      create: expect.objectContaining({
        statementExternalId: "11796795500890875355",
        transactionType: "payout_statement",
        feeType: "payout_paid",
        amountMinor: null,
        amount: null,
        currency: "USD",
        rawPayload: expect.not.objectContaining({ payee_id: expect.anything() }),
      }),
    }));
    expect(setMarketplaceCapability).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shopee",
      shopId: "shop-record",
      capability: "settlements",
      state: "available",
      endpointVersion: "/payment/get_payout_info",
    }));
    expect(prismaMock.marketplaceFinancialRecord.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(setMarketplaceCapability.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it("does not observe settlements when a payout lacks documented final evidence", async () => {
    sdk.payment.getPayoutInfo.mockResolvedValue({
      response: { payout_list: [{ ...finalPayout, payout_time: undefined }], more: false, next_cursor: "" },
    });

    const result = await syncShopeePayoutStatements(123, "user-record");

    expect(result).toMatchObject({ synced: 0, created: 0, updated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(prismaMock.marketplaceFinancialRecord.upsert).not.toHaveBeenCalled();
    expect(setMarketplaceCapability).not.toHaveBeenCalled();
  });
});

describe("Shopee escrow finance observations", () => {
  it("writes one sanitized unknown-quality ledger row before marking finance available", async () => {
    sdk.payment.getEscrowDetailBatch.mockResolvedValue({
      response: {
        order_income_list: [{
          order_sn: "ORDER-1",
          buyer_user_name: "private-buyer",
          order_income: { escrow_amount: 42.5, commission_fee: 1.25 },
          buyer_payment_info: { buyer_payment_method: "Credit Card" },
        }],
      },
    });

    await syncShopeeOrders(123, "user-record");

    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        platform_shopId_externalId: {
          platform: "shopee",
          shopId: "shop-record",
          externalId: "escrow:ORDER-1",
        },
      },
      create: expect.objectContaining({
        orderExternalId: "ORDER-1",
        financialQuality: "unknown",
        unknownReason: "source_observed_unverified",
        amount: null,
        amountMinor: null,
        rawPayload: expect.not.objectContaining({ buyer_user_name: expect.anything() }),
      }),
    }));
    expect(setMarketplaceCapability).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shopee",
      shopId: "shop-record",
      capability: "finance",
      state: "available",
    }));
    expect(prismaMock.marketplaceFinancialRecord.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(setMarketplaceCapability.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it("records an unauthorized finance capability when escrow authorization fails without blocking orders", async () => {
    sdk.payment.getEscrowDetailBatch.mockRejectedValue(Object.assign(new Error("escrow permission denied"), {
      status: 403,
      data: { error: "error_auth" },
    }));

    const result = await syncShopeeOrders(123, "user-record");

    expect(result.synced).toBe(1);
    expect(prismaMock.marketplaceFinancialRecord.upsert).not.toHaveBeenCalled();
    expect(setMarketplaceCapability).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shopee",
      capability: "finance",
      state: "unauthorized",
      errorCode: "error_auth",
    }));
  });
});
