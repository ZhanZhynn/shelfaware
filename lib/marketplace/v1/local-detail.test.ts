import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  shopeeOrderFindFirst: vi.fn(),
  shopeeProductFindFirst: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({
  prisma: {
    shopeeOrder: { findFirst: mocks.shopeeOrderFindFirst },
    shopeeProduct: { findFirst: mocks.shopeeProductFindFirst },
  },
}));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));

import { getMarketplaceOrder, getMarketplaceProduct, MarketplaceV1ValidationError, parseMarketplaceRecordId } from "./local-catalog";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
});

describe("v1 local marketplace detail mappings", () => {
  it("uses an owned canonical ID and emits normalized, PII-redacted order line items", async () => {
    mocks.shopeeOrderFindFirst.mockResolvedValue({
      id: "a".repeat(24), shopId: "b".repeat(24), shopeeOrderId: "ORDER-1", orderStatus: "SHIPPED", paymentStatus: "PAID", totalAmount: 42, currency: "MYR",
      trackingNumber: "TRACK-1", trackingCarrier: "Carrier", logisticsStatus: "DELIVERED", shippingFee: 3, fulfillmentStatus: "FULFILLED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: null, shopeeCreatedAt: null, shopeeUpdatedAt: null, paidAt: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null,
      // These values emulate fields on the underlying record. The endpoint must
      // neither select nor serialize them.
      buyerEmail: "buyer@example.test", buyerUsername: "buyer", shippingAddress: { phone: "123" },
      items: [{ id: "c".repeat(24), shopeeItemId: 12, shopeeModelId: 34, productName: "Widget", sku: "WIDGET-RED", quantity: 2, price: 20, subtotal: 40 }],
    });

    const result = await getMarketplaceOrder("shopee", { id: "actor-1", role: "admin" }, "a".repeat(24));

    expect(mocks.shopeeOrderFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a".repeat(24), userId: { in: ["owner-1"] } } }));
    const select = mocks.shopeeOrderFindFirst.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty("buyerEmail");
    expect(select).not.toHaveProperty("buyerUsername");
    expect(select).not.toHaveProperty("shippingAddress");
    expect(result).toMatchObject({ externalId: "ORDER-1", lineItems: [{ externalLineId: null, productExternalId: "12", variantExternalId: "34", sku: "WIDGET-RED", subtotal: 40 }] });
    expect(result).not.toHaveProperty("buyerEmail");
    expect(result).not.toHaveProperty("shippingAddress");
  });

  it("normalizes persisted product variants without returning source-only JSON", async () => {
    mocks.shopeeProductFindFirst.mockResolvedValue({
      id: "a".repeat(24), shopId: "b".repeat(24), shopeeItemId: 12, itemName: "Widget", description: null, itemSku: "WIDGET", categoryId: 1,
      price: 20, originalPrice: 25, stock: 4, imageUrl: null, status: "NORMAL", weight: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: null, lastSyncedAt: null,
      tierVariation: [{ name: "Color" }], variants: [{ id: "c".repeat(24), modelId: 34, modelName: "Red", modelSku: "WIDGET-RED", price: 20, originalPrice: 25, stock: 4, status: "MODEL_NORMAL" }],
    });

    const result = await getMarketplaceProduct("shopee", { id: "actor-1", role: "admin" }, "a".repeat(24));

    expect(result).toMatchObject({ externalId: "12", variants: [{ externalId: "34", title: "Red", sku: "WIDGET-RED", stock: 4 }] });
    expect(result).not.toHaveProperty("tierVariation");
  });

  it("rejects non-canonical record IDs before querying a record", () => {
    expect(() => parseMarketplaceRecordId("external-order-id")).toThrow(MarketplaceV1ValidationError);
  });
});
