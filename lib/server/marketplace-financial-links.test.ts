import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  marketplaceFinancialRecord: { findMany: vi.fn(), update: vi.fn() },
  lazadaOrder: { findMany: vi.fn() },
  tikTokOrder: { findMany: vi.fn() },
  shopifyOrder: { findMany: vi.fn() },
  shopeeOrder: { findMany: vi.fn() },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("server-only", () => ({}));

import { linkMarketplaceFinancialRecords } from "./marketplace-financial-links";

describe("linkMarketplaceFinancialRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.marketplaceFinancialRecord.update.mockResolvedValue({});
    prismaMock.lazadaOrder.findMany.mockResolvedValue([]);
    prismaMock.tikTokOrder.findMany.mockResolvedValue([]);
    prismaMock.shopifyOrder.findMany.mockResolvedValue([]);
    prismaMock.shopeeOrder.findMany.mockResolvedValue([]);
  });

  it("links only Lazada provider IDs scoped to the selected shop", async () => {
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([
      { id: "linked", orderExternalId: "lazada-order" },
      { id: "unmatched", orderExternalId: "missing-order" },
      { id: "not-applicable", orderExternalId: null },
    ]);
    prismaMock.lazadaOrder.findMany.mockResolvedValue([{ id: "internal-order", lazadaOrderId: "lazada-order" }]);

    await expect(linkMarketplaceFinancialRecords("lazada", "shop-1")).resolves.toEqual({ linked: 1, unmatched: 1, notApplicable: 1 });

    expect(prismaMock.lazadaOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shopId: "shop-1", lazadaOrderId: { in: ["lazada-order", "missing-order"] } },
    }));
    expect(prismaMock.marketplaceFinancialRecord.update).toHaveBeenCalledWith({ where: { id: "linked" }, data: { orderInternalId: "internal-order", orderLinkState: "linked" } });
    expect(prismaMock.marketplaceFinancialRecord.update).toHaveBeenCalledWith({ where: { id: "unmatched" }, data: { orderInternalId: null, orderLinkState: "unmatched" } });
    expect(prismaMock.marketplaceFinancialRecord.update).toHaveBeenCalledWith({ where: { id: "not-applicable" }, data: { orderInternalId: null, orderLinkState: "not_applicable" } });
  });

  it.each([
    ["shopee", "shopeeOrder", "shopeeOrderId"],
    ["tiktok", "tikTokOrder", "tiktokOrderId"],
    ["shopify", "shopifyOrder", "shopifyOrderId"],
  ] as const)("uses %s native order IDs", async (platform, model, field) => {
    prismaMock.marketplaceFinancialRecord.findMany.mockResolvedValue([{ id: "record", orderExternalId: "provider-order" }]);
    prismaMock[model].findMany.mockResolvedValue([{ id: "internal-order", [field]: "provider-order" }]);

    await linkMarketplaceFinancialRecords(platform, "shop-1");

    expect(prismaMock[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: "shop-1", [field]: { in: ["provider-order"] } } }));
  });
});
