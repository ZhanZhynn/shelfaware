import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, transactionClient } = vi.hoisted(() => {
  const transactionClient = {
    marketplaceSkuMappingOfferLock: { upsert: vi.fn() },
    salesSku: { findUnique: vi.fn(), findMany: vi.fn() },
    shopeeProduct: { findFirst: vi.fn() },
    shopeeProductVariant: { findFirst: vi.fn() },
    marketplaceSkuMapping: { findMany: vi.fn(), create: vi.fn() },
    marketplaceSkuMappingEvent: { create: vi.fn(), createMany: vi.fn() },
    marketplaceSkuCandidate: { updateMany: vi.fn() },
    marketplaceSkuMappingCsvImportBatch: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    marketplaceSkuMappingCsvImportRow: { update: vi.fn() },
  };
  return {
    transactionClient,
    prismaMock: {
      $transaction: vi.fn(),
      shopeeProduct: { findFirst: vi.fn(), findMany: vi.fn() },
      shopeeProductVariant: { findFirst: vi.fn() },
      shopeeOrderItem: { findFirst: vi.fn(), findMany: vi.fn() },
      marketplaceSkuMapping: { findMany: vi.fn() },
      marketplaceSkuMappingCsvImportBatch: { findFirst: vi.fn() },
    },
  };
});

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import {
  commitCsvMappingDraft,
  confirmMapping,
  earliestEligibleSale,
  canonicalShopeeOffer,
  previewMapping,
  resolveShopeeOffer,
  withOfferLocks,
} from "./service";

const input = {
  platform: "shopee" as const,
  shopId: "shop",
  externalProductId: "10",
  offerKind: "verified-product" as const,
  salesSkuId: "sku",
};

describe("verified nonvariant Shopee attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shopeeProduct.findFirst.mockResolvedValue({ id: "product" });
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      { shopeeItemId: 10, itemSku: "SKU-10" },
    ]);
    prismaMock.shopeeOrderItem.findFirst.mockResolvedValue({
      order: { shopeeCreatedAt: new Date("2026-01-01") },
    });
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        subtotal: 12,
        shopeeItemId: 10,
        sku: "SKU-10",
        productName: "Product",
        order: { currency: "MYR", shopeeCreatedAt: new Date("2026-01-01") },
      },
    ]);
    prismaMock.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    transactionClient.marketplaceSkuMappingOfferLock.upsert.mockResolvedValue(
      {},
    );
    transactionClient.salesSku.findUnique.mockResolvedValue({
      id: "sku",
      active: true,
    });
    transactionClient.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    transactionClient.marketplaceSkuMapping.create.mockResolvedValue({
      id: "mapping",
    });
    transactionClient.marketplaceSkuMappingEvent.create.mockResolvedValue({});
    transactionClient.marketplaceSkuCandidate.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaMock.$transaction.mockImplementation((operation) =>
      operation(transactionClient),
    );
  });

  it("accepts legacy modelId 0 source lines for verified product resolution, preview, and sale lookup", async () => {
    await expect(resolveShopeeOffer(input)).resolves.toBe("shopee:10:product");
    await expect(earliestEligibleSale(input)).resolves.toEqual(
      new Date("2026-01-01"),
    );
    await expect(
      previewMapping({ ...input, effectiveFrom: new Date("2026-01-01") }),
    ).resolves.toMatchObject({ affectedLines: 1, affectedUnits: 2 });

    expect(prismaMock.shopeeProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ variants: { none: {} } }),
      }),
    );
    expect(prismaMock.shopeeOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ shopeeModelId: null }, { shopeeModelId: 0 }],
        }),
      }),
    );
  });

  it("attributes a legacy nonvariant line without shopeeItemId only through its unique same-shop SKU", async () => {
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        subtotal: 12,
        shopeeItemId: null,
        sku: "SKU-10",
        productName: "Renamed",
        order: { currency: "MYR", shopeeCreatedAt: new Date("2026-01-01") },
      },
    ]);

    await expect(earliestEligibleSale(input)).resolves.toEqual(
      new Date("2026-01-01"),
    );
    await expect(
      previewMapping({ ...input, effectiveFrom: new Date("2026-01-01") }),
    ).resolves.toMatchObject({
      affectedLines: 1,
      affectedUnits: 2,
      unverifiableLegacyLines: 0,
    });
  });

  it("counts only unresolved legacy lines with the selected offer's SKU fallback", async () => {
    prismaMock.shopeeProduct.findMany.mockResolvedValue([
      { shopeeItemId: 10, itemSku: "SKU-10" },
      { shopeeItemId: 11, itemSku: "SKU-10" },
    ]);
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        subtotal: 12,
        shopeeItemId: null,
        sku: "SKU-10",
        productName: "Product",
        order: { currency: "MYR", shopeeCreatedAt: new Date("2026-01-01") },
      },
      {
        quantity: 1,
        subtotal: 6,
        shopeeItemId: null,
        sku: "OTHER",
        productName: "Other",
        order: { currency: "MYR", shopeeCreatedAt: new Date("2026-01-01") },
      },
    ]);

    await expect(
      previewMapping({ ...input, effectiveFrom: new Date("2026-01-01") }),
    ).resolves.toMatchObject({ affectedLines: 0, unverifiableLegacyLines: 1 });
  });

  it("serializes confirmation through the durable offer lock", async () => {
    const mapping = await confirmMapping(
      { ...input, salesSkuId: "sku", effectiveFrom: new Date("2026-01-01") },
      "actor",
    );

    expect(mapping).toMatchObject({ id: "mapping" });
    expect(
      transactionClient.marketplaceSkuMappingOfferLock.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_shopId_offerKey: {
            platform: "shopee",
            shopId: "shop",
            offerKey: "shopee:10:product",
          },
        },
      }),
    );
    expect(
      transactionClient.marketplaceSkuMappingOfferLock.upsert.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      transactionClient.marketplaceSkuMapping.findMany.mock
        .invocationCallOrder[0]!,
    );
  });

  it("canonicalizes external IDs before source lookup and persisted offer keys", async () => {
    await expect(
      confirmMapping(
        {
          ...input,
          externalProductId: "00010",
          salesSkuId: "sku",
          effectiveFrom: new Date("2026-01-01"),
        },
        "actor",
      ),
    ).resolves.toMatchObject({ id: "mapping" });
    expect(transactionClient.marketplaceSkuMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalProductId: "10",
          offerKey: "shopee:10:product",
        }),
      }),
    );
  });

  it("uses the product sentinel even if a service caller supplies a variant ID", () => {
    expect(
      canonicalShopeeOffer({
        externalProductId: "00010",
        externalVariantId: "0004",
        offerKind: "verified-product",
      }),
    ).toEqual({
      externalProductId: "10",
      externalVariantId: undefined,
      offerKey: "shopee:10:product",
    });
  });

  it("does not use a stale variant parent when a variant line has a direct conflicting item ID", async () => {
    const variantInput = {
      platform: "shopee" as const,
      shopId: "shop",
      externalProductId: "10",
      externalVariantId: "4",
      offerKind: "variant" as const,
      salesSkuId: "sku",
    };
    prismaMock.shopeeProductVariant.findFirst.mockResolvedValue({ id: "offer" });
    prismaMock.shopeeOrderItem.findFirst.mockResolvedValue({
      order: { shopeeCreatedAt: new Date("2026-01-02") },
    });
    prismaMock.shopeeOrderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        subtotal: 12,
        order: { currency: "MYR", shopeeCreatedAt: new Date("2026-01-02") },
      },
    ]);

    await expect(earliestEligibleSale(variantInput)).resolves.toEqual(
      new Date("2026-01-02"),
    );
    await expect(
      previewMapping({ ...variantInput, effectiveFrom: new Date("2026-01-02") }),
    ).resolves.toMatchObject({ affectedLines: 1, affectedUnits: 2 });
    for (const call of [
      prismaMock.shopeeOrderItem.findFirst.mock.calls[0],
      prismaMock.shopeeOrderItem.findMany.mock.calls.at(-1),
    ])
      expect(call?.[0]).toMatchObject({
        where: {
          shopeeModelId: 4,
          OR: [
            { shopeeItemId: 10 },
            { shopeeItemId: null, variant: { is: { shopeeItemId: 10 } } },
          ],
        },
      });
  });

  it("rejects candidate acceptance unless the exact open candidate matches the offer and Sales SKU", async () => {
    transactionClient.marketplaceSkuCandidate.updateMany.mockResolvedValue({
      count: 0,
    });
    await expect(
      confirmMapping(
        {
          ...input,
          salesSkuId: "sku",
          candidateId: "candidate",
          effectiveFrom: new Date("2026-01-01"),
        },
        "actor",
      ),
    ).rejects.toThrow("candidate is stale");
    expect(
      transactionClient.marketplaceSkuMapping.create,
    ).not.toHaveBeenCalled();
    expect(
      transactionClient.marketplaceSkuCandidate.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "candidate",
          OR: [
            { proposedSalesSkuId: "sku" },
            { draftSalesSkuId: "sku" },
          ],
          status: "open",
        }),
      }),
    );
  });

  it("revalidates archived SKUs, source ownership, and conflicts inside locked CSV commits without creating mappings", async () => {
    const row = {
      rowNumber: 2,
      platform: "shopee",
      shopId: "shop",
      externalProductId: "10",
      externalVariantId: "4",
      salesSkuCode: "SKU",
      effectiveFrom: new Date("2026-01-01"),
      validationSnapshot: { valid: true },
    };
    const draft = {
      id: "batch",
      actorId: "actor",
      status: "draft",
      validationSnapshot: { valid: true },
      commitIdempotencyKey: null,
      commitPayloadFingerprint: null,
      rows: [row],
    };
    prismaMock.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(
      draft,
    );
    transactionClient.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(
      draft,
    );
    transactionClient.salesSku.findMany.mockResolvedValue([]);
    transactionClient.shopeeProductVariant.findFirst.mockResolvedValue(null);
    transactionClient.marketplaceSkuMapping.findMany.mockResolvedValue([
      {
        shopId: "shop",
        offerKey: "shopee:10:4",
        effectiveFrom: new Date("2025-01-01"),
        effectiveTo: null,
      },
    ]);

    await expect(
      commitCsvMappingDraft("batch", "commit-key-123456", "actor"),
    ).rejects.toThrow("CSV draft is stale");
    expect(transactionClient.salesSku.findMany).toHaveBeenCalled();
    expect(transactionClient.shopeeProductVariant.findFirst).toHaveBeenCalled();
    expect(
      transactionClient.marketplaceSkuMapping.create,
    ).not.toHaveBeenCalled();
  });

  it("commits a valid batch atomically and replays only its matching commit key", async () => {
    const rows = [{
      rowNumber: 2,
      platform: "shopee",
      shopId: "shop",
      externalProductId: "20",
      externalVariantId: "4",
      salesSkuCode: "SKU",
      effectiveFrom: new Date("2026-01-01"),
      validationSnapshot: { valid: true },
    }, {
      rowNumber: 3,
      platform: "shopee",
      shopId: "shop",
      externalProductId: "10",
      externalVariantId: "5",
      salesSkuCode: "SKU2",
      effectiveFrom: new Date("2026-01-01"),
      validationSnapshot: { valid: true },
    }];
    const draft = {
      id: "batch",
      actorId: "actor",
      status: "draft",
      validationSnapshot: { valid: true },
      commitIdempotencyKey: null,
      commitPayloadFingerprint: null,
      rows,
    };
    prismaMock.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(
      draft,
    );
    transactionClient.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(
      draft,
    );
    transactionClient.salesSku.findMany.mockResolvedValue([
      { id: "sku", code: "SKU" },
      { id: "sku2", code: "SKU2" },
    ]);
    transactionClient.shopeeProductVariant.findFirst.mockResolvedValue({
      id: "offer",
    });
    transactionClient.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    transactionClient.marketplaceSkuMapping.create
      .mockResolvedValueOnce({ id: "mapping-20" })
      .mockResolvedValueOnce({ id: "mapping-10" });
    transactionClient.marketplaceSkuMappingEvent.createMany.mockResolvedValue(
      {},
    );
    transactionClient.marketplaceSkuMappingCsvImportRow.update.mockResolvedValue(
      {},
    );
    transactionClient.marketplaceSkuMappingCsvImportBatch.update.mockResolvedValue(
      {
        ...draft,
        status: "committed",
        commitIdempotencyKey: "commit-key-123456",
      },
    );

    await expect(
      commitCsvMappingDraft("batch", "commit-key-123456", "actor"),
    ).resolves.toMatchObject({ status: "committed" });
    expect(
      transactionClient.marketplaceSkuMapping.create,
    ).toHaveBeenCalledTimes(2);
    expect(
      transactionClient.marketplaceSkuMappingOfferLock.upsert.mock.calls.map(
        (call) => call[0].where.platform_shopId_offerKey.offerKey,
      ),
    ).toEqual(["shopee:10:5", "shopee:20:4"]);
    expect(
      transactionClient.marketplaceSkuMappingCsvImportRow.update.mock.calls.map(
        (call) => call[0].data.mappingResult.mappingId,
      ),
    ).toEqual(["mapping-20", "mapping-10"]);
    expect(
      transactionClient.marketplaceSkuMappingCsvImportBatch.update,
    ).toHaveBeenCalledTimes(1);

    prismaMock.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue({
      ...draft,
      status: "committed",
      commitIdempotencyKey: "commit-key-123456",
      commitPayloadFingerprint: undefined,
    });
    // A different key must never replay the committed batch.
    await expect(
      commitCsvMappingDraft("batch", "other-commit-key-1", "actor"),
    ).rejects.toThrow("already committed");
  });

  it("deduplicates duplicate offer locks before acquiring them", async () => {
    await withOfferLocks(
      [
        { platform: "shopee", shopId: "shop", offerKey: "shopee:10:4" },
        { platform: "shopee", shopId: "shop", offerKey: "shopee:10:4" },
      ],
      async () => "locked",
    );
    expect(transactionClient.marketplaceSkuMappingOfferLock.upsert).toHaveBeenCalledTimes(1);
  });

  it("rolls back all rows in a faithful transactional fake when a later row fails", async () => {
    const persisted: string[] = [];
    const rows = [
      {
        rowNumber: 2,
        platform: "shopee",
        shopId: "shop",
        externalProductId: "10",
        externalVariantId: "4",
        salesSkuCode: "SKU",
        effectiveFrom: new Date("2026-01-01"),
        validationSnapshot: { valid: true },
      },
      {
        rowNumber: 3,
        platform: "shopee",
        shopId: "shop",
        externalProductId: "20",
        externalVariantId: "5",
        salesSkuCode: "SKU2",
        effectiveFrom: new Date("2026-01-01"),
        validationSnapshot: { valid: true },
      },
    ];
    const draft = {
      id: "batch",
      actorId: "actor",
      status: "draft",
      validationSnapshot: { valid: true },
      commitIdempotencyKey: null,
      commitPayloadFingerprint: null,
      rows,
    };
    prismaMock.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(draft);
    transactionClient.marketplaceSkuMappingCsvImportBatch.findFirst.mockResolvedValue(draft);
    transactionClient.salesSku.findMany.mockResolvedValue([
      { id: "sku", code: "SKU" },
      { id: "sku2", code: "SKU2" },
    ]);
    transactionClient.shopeeProductVariant.findFirst.mockResolvedValue({ id: "offer" });
    transactionClient.marketplaceSkuMapping.findMany.mockResolvedValue([]);
    transactionClient.marketplaceSkuMapping.create.mockImplementation(async () => {
      if (persisted.length === 1) throw new Error("later row failed");
      persisted.push("first");
      return { id: "mapping-first" };
    });
    prismaMock.$transaction.mockImplementation(async (operation) => {
      const snapshot = [...persisted];
      try {
        return await operation(transactionClient);
      } catch (error) {
        persisted.splice(0, persisted.length, ...snapshot);
        throw error;
      }
    });
    await expect(
      commitCsvMappingDraft("batch", "commit-key-123456", "actor"),
    ).rejects.toThrow("later row failed");
    expect(persisted).toEqual([]);
    expect(transactionClient.marketplaceSkuMappingCsvImportRow.update).not.toHaveBeenCalled();
    expect(transactionClient.marketplaceSkuMappingCsvImportBatch.update).not.toHaveBeenCalled();
  });
});
