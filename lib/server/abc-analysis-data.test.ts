import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    shopeeShop: { findMany: vi.fn() },
    shopeeOrderItem: { findMany: vi.fn() },
    shopeeProductVariant: { findMany: vi.fn() },
    shopeeProduct: { findMany: vi.fn() },
    productChannelMapping: { findMany: vi.fn() },
  },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { getAbcAnalysisForUser } from "./abc-analysis-data";

describe("getAbcAnalysisForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shopeeShop.findMany.mockResolvedValue([{ id: "shop-1" }]);
    prismaMock.shopeeProductVariant.findMany.mockResolvedValue([]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([]);
    prismaMock.productChannelMapping.findMany.mockResolvedValue([]);
  });

  it("uses linked variant stock when earlier orders for the same listing are unlinked", async () => {
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        variantId: null,
        productId: null,
        productName: "Bahulu Box",
        sku: "PPM-KB003-ZZS(50)",
        quantity: 1,
        price: 20,
        subtotal: 20,
        order: { shopId: "shop-1" },
        variant: null,
      },
      {
        variantId: "variant-1",
        productId: null,
        productName: "Bahulu Box",
        sku: "PPM-KB003-ZZS(50)",
        quantity: 2,
        price: 20,
        subtotal: 40,
        order: { shopId: "shop-1" },
        variant: {
          id: "variant-1",
          stock: 43,
          product: { id: "product-1", itemName: "Bahulu Box", itemSku: "-", price: 20, stock: 100 },
        },
      },
    ]);

    const result = await getAbcAnalysisForUser("user-1", "2026-07-04", "2026-08-03", "shopee");

    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      sku: "PPM-KB003-ZZS(50)",
      unitsSold: 3,
      revenue: 60,
      stockOnHand: 43,
    });
  });

  it("resolves current stock through an unlinked order item's Shopee model ID", async () => {
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        variantId: null,
        productId: null,
        shopeeModelId: 42,
        productName: "Paper Bag",
        sku: "BAG-42",
        quantity: 1,
        price: 5,
        subtotal: 5,
        order: { shopId: "shop-1" },
        variant: null,
      },
    ]);
    prismaMock.shopeeProductVariant.findMany.mockResolvedValue([
      {
        id: "variant-42",
        shopId: "shop-1",
        modelId: 42,
        stock: 89,
        product: { id: "product-42", itemName: "Paper Bag", itemSku: "-", price: 5, stock: 100 },
      },
    ]);

    const result = await getAbcAnalysisForUser("user-1", "2026-07-04", "2026-08-03", "shopee");

    expect(result.products[0]).toMatchObject({
      sku: "BAG-42",
      stockOnHand: 89,
    });
  });

  it("resolves current stock through an unlinked parent listing with an exact SKU and title", async () => {
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        variantId: null,
        productId: null,
        shopeeModelId: 0,
        productName: "Paper Cup Holder",
        sku: "CUP-4",
        quantity: 1,
        price: 5,
        subtotal: 5,
        order: { shopId: "shop-1" },
        variant: null,
      },
    ]);
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      {
        id: "product-4",
        shopId: "shop-1",
        itemName: "Paper Cup Holder",
        itemSku: "CUP-4",
        price: 5,
        stock: 52,
      },
    ]);

    const result = await getAbcAnalysisForUser("user-1", "2026-07-04", "2026-08-03", "shopee");

    expect(result.products[0]).toMatchObject({
      sku: "CUP-4",
      stockOnHand: 52,
    });
  });
});
