import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    product: { findMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
    productReview: { groupBy: vi.fn() },
    category: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    productChannelMapping: { groupBy: vi.fn() },
  },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { getProductPerformance } from "./product-performance-data";

const product = {
  id: "product-1", name: "New item", sku: "NEW-1", quantity: 10, reservedQuantity: 0,
  status: "active", categoryId: null, supplierId: null, createdAt: new Date("2026-01-29T00:00:00.000Z"), channelMappings: [],
};

describe("getProductPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([product]);
    prismaMock.orderItem.findMany.mockResolvedValue([]);
    prismaMock.productReview.groupBy.mockResolvedValue([]);
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.supplier.findMany.mockResolvedValue([]);
    prismaMock.productChannelMapping.groupBy.mockResolvedValue([]);
  });

  it("does not classify a newly listed zero-sale product as excess", async () => {
    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"));

    expect(data.products[0]).toMatchObject({ recommendation: "needs-data", confidence: "needs-data", coverage: "3 observed days; at least 7 are required" });
  });

  it("queries WMS orders through the normalized selected end day", async () => {
    const end = new Date("2026-01-31T23:59:59.999Z");
    prismaMock.orderItem.findMany.mockResolvedValue([{ productId: "product-1", quantity: 2, subtotal: 20, order: { createdAt: end } }]);
    const data = await getProductPerformance("owner-1", new Date("2026-01-01T00:00:00.000Z"), end);

    expect(prismaMock.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order: expect.objectContaining({ createdAt: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: end } }) }),
    }));
    expect(data.products[0]?.unitsSold).toBe(2);
  });

  it("includes workspace products for the shared admin scope and sales from their creators", async () => {
    await getProductPerformance("admin-1", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z"), { ownerIds: ["admin-1"], sharedAdmin: true });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: [{ userId: { in: ["admin-1"] }, workspaceId: null }, { workspaceId: { not: null } }] })]) }),
    }));
    expect(prismaMock.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order: expect.not.objectContaining({ userId: expect.anything() }) }),
    }));
  });
});
