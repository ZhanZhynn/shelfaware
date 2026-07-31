import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, sdk, getShopeeSDK, setMarketplaceCapability } = vi.hoisted(() => {
  const sdk = {
    order: {
      getOrderList: vi.fn(),
      getOrdersDetail: vi.fn(),
      searchPackageList: vi.fn(),
    },
    payment: { getEscrowDetailBatch: vi.fn() },
  };
  const prismaMock = {
    shopeeShop: { findFirst: vi.fn(), update: vi.fn() },
    shopeeSyncLog: { create: vi.fn(), update: vi.fn() },
    shopeeProductVariant: { findMany: vi.fn() },
    shopeeOrder: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    shopeeOrderItem: { deleteMany: vi.fn(), create: vi.fn() },
    marketplaceFinancialRecord: { upsert: vi.fn() },
  };
  return { prismaMock, sdk, getShopeeSDK: vi.fn(), setMarketplaceCapability: vi.fn() };
});

vi.mock("./server", () => ({ getShopeeSDK }));
vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability }));

import { syncShopeeOrders } from "./sync";

function configureOrderSync() {
  prismaMock.shopeeShop.findFirst.mockResolvedValue({ id: "shop-record", shopId: 123 });
  prismaMock.shopeeSyncLog.create.mockResolvedValue({ id: "sync-log" });
  prismaMock.shopeeProductVariant.findMany.mockResolvedValue([]);
  prismaMock.shopeeOrder.findFirst.mockResolvedValue({ id: "order-record" });
  prismaMock.shopeeOrder.update.mockResolvedValue({ id: "order-record" });
  prismaMock.shopeeSyncLog.update.mockResolvedValue({});
  prismaMock.shopeeShop.update.mockResolvedValue({});
  prismaMock.marketplaceFinancialRecord.upsert.mockResolvedValue({});
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
