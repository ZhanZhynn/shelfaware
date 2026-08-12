import prisma from "@/prisma/client";
import { normalizeSku } from "./intervals";

export type LegacyMigrationCandidate = {
  legacyMappingId: string;
  wmsProductId: string;
  wmsProductSku: string;
  wmsProductName: string;
  channel: string;
  channelProductId: string;
  channelType: string;
  platform: "shopee";
  shopId: string;
  externalProductId: string;
  externalVariantId: string | null;
  offerKey: string;
  offerKind: "variant" | "verified-product";
  normalizedSku: string;
  proposedSalesSkuId: string | null;
  proposedSalesSkuCode: string | null;
  confidence: string;
  ambiguous: boolean;
  ambiguityReason: string | null;
  alreadyMapped: boolean;
};

export type MigrationSummary = {
  totalLegacyRows: number;
  proposedCandidates: number;
  ambiguousRows: number;
  skippedRows: number;
  alreadyMappedRows: number;
  noSkuMatchRows: number;
};

export type MigrationResult = {
  candidates: LegacyMigrationCandidate[];
  summary: MigrationSummary;
};

function shopeeOfferKey(
  externalProductId: string,
  externalVariantId: string | null,
): string {
  return externalVariantId
    ? `shopee:${externalProductId}:${externalVariantId}`
    : `shopee:${externalProductId}:product`;
}

export async function proposeMigrationCandidates(): Promise<MigrationResult> {
  const legacyRows = await prisma.productChannelMapping.findMany({
    where: { channel: "shopee" },
    include: {
      wmsProduct: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const activeMappings = await prisma.marketplaceSkuMapping.findMany({
    where: { platform: "shopee", effectiveTo: null },
    select: { shopId: true, offerKey: true },
  });
  const mappedKeys = new Set(
    activeMappings.map((m) => `${m.shopId}:${m.offerKey}`),
  );

  const salesSkus = await prisma.salesSku.findMany({
    where: { active: true },
    select: { id: true, code: true },
  });
  const skuByNormalized = new Map(
    salesSkus.map((s) => [normalizeSku(s.code), s]),
  );

  const channelProducts = await prisma.shopeeProduct.findMany({
    where: {
      id: { in: legacyRows.map((r) => r.channelProductId) },
    },
    select: {
      id: true,
      shopId: true,
      shopeeItemId: true,
      itemSku: true,
      variants: {
        select: { id: true, modelId: true, modelSku: true },
      },
    },
  });
  const productById = new Map(channelProducts.map((p) => [p.id, p]));

  const candidates: LegacyMigrationCandidate[] = [];
  let ambiguousRows = 0;
  let skippedRows = 0;
  let alreadyMappedRows = 0;
  let noSkuMatchRows = 0;

  for (const row of legacyRows) {
    const product = productById.get(row.channelProductId);
    if (!product) {
      skippedRows++;
      continue;
    }

    const shopId = product.shopId;
    const externalProductId = String(product.shopeeItemId);

    if (row.channelType === "variant" && product.variants.length > 0) {
      let rowHasAlreadyMapped = false;
      let rowHasNoSkuMatch = false;

      for (const variant of product.variants) {
        const externalVariantId = String(variant.modelId);
        const offerKey = shopeeOfferKey(externalProductId, externalVariantId);
        const mappedKey = `${shopId}:${offerKey}`;

        const variantSku = variant.modelSku ?? product.itemSku ?? "";
        const normalizedSku = normalizeSku(variantSku);
        const match = skuByNormalized.get(normalizedSku);

        if (mappedKeys.has(mappedKey)) {
          rowHasAlreadyMapped = true;
          candidates.push({
            legacyMappingId: row.id,
            wmsProductId: row.wmsProductId,
            wmsProductSku: row.wmsProduct.sku,
            wmsProductName: row.wmsProduct.name,
            channel: row.channel,
            channelProductId: row.channelProductId,
            channelType: row.channelType,
            platform: "shopee",
            shopId,
            externalProductId,
            externalVariantId,
            offerKey,
            offerKind: "variant",
            normalizedSku,
            proposedSalesSkuId: match?.id ?? null,
            proposedSalesSkuCode: match?.code ?? null,
            confidence: match ? "legacy-migration-exact" : "legacy-migration-no-sku",
            ambiguous: false,
            ambiguityReason: null,
            alreadyMapped: true,
          });
          continue;
        }

        if (!match) rowHasNoSkuMatch = true;

        candidates.push({
          legacyMappingId: row.id,
          wmsProductId: row.wmsProductId,
          wmsProductSku: row.wmsProduct.sku,
          wmsProductName: row.wmsProduct.name,
          channel: row.channel,
          channelProductId: row.channelProductId,
          channelType: row.channelType,
          platform: "shopee",
          shopId,
          externalProductId,
          externalVariantId,
          offerKey,
          offerKind: "variant",
          normalizedSku,
          proposedSalesSkuId: match?.id ?? null,
          proposedSalesSkuCode: match?.code ?? null,
          confidence: match ? "legacy-migration-exact" : "legacy-migration-no-sku",
          ambiguous: false,
          ambiguityReason: null,
          alreadyMapped: false,
        });
      }

      if (rowHasAlreadyMapped) alreadyMappedRows++;
      if (rowHasNoSkuMatch) noSkuMatchRows++;
    } else {
      const offerKey = shopeeOfferKey(externalProductId, null);
      const mappedKey = `${shopId}:${offerKey}`;

      const sameProductLinks = legacyRows.filter(
        (r) =>
          r.channelProductId === row.channelProductId &&
          r.channel === "shopee" &&
          r.id !== row.id,
      );
      const isAmbiguous = sameProductLinks.length > 0;

      const parentSku = product.itemSku ?? "";
      const normalizedSku = normalizeSku(parentSku);
      const match = skuByNormalized.get(normalizedSku);

      if (mappedKeys.has(mappedKey)) {
        alreadyMappedRows++;
        candidates.push({
          legacyMappingId: row.id,
          wmsProductId: row.wmsProductId,
          wmsProductSku: row.wmsProduct.sku,
          wmsProductName: row.wmsProduct.name,
          channel: row.channel,
          channelProductId: row.channelProductId,
          channelType: row.channelType,
          platform: "shopee",
          shopId,
          externalProductId,
          externalVariantId: null,
          offerKey,
          offerKind: "verified-product",
          normalizedSku,
          proposedSalesSkuId: match?.id ?? null,
          proposedSalesSkuCode: match?.code ?? null,
          confidence: match ? "legacy-migration-exact" : "legacy-migration-no-sku",
          ambiguous: isAmbiguous,
          ambiguityReason: isAmbiguous
            ? "Multiple legacy ProductChannelMapping rows point to the same Shopee product from different WMS products."
            : null,
          alreadyMapped: true,
        });
        continue;
      }

      if (isAmbiguous) ambiguousRows++;
      if (!match) noSkuMatchRows++;

      candidates.push({
        legacyMappingId: row.id,
        wmsProductId: row.wmsProductId,
        wmsProductSku: row.wmsProduct.sku,
        wmsProductName: row.wmsProduct.name,
        channel: row.channel,
        channelProductId: row.channelProductId,
        channelType: row.channelType,
        platform: "shopee",
        shopId,
        externalProductId,
        externalVariantId: null,
        offerKey,
        offerKind: "verified-product",
        normalizedSku,
        proposedSalesSkuId: match?.id ?? null,
        proposedSalesSkuCode: match?.code ?? null,
        confidence: match ? "legacy-migration-exact" : "legacy-migration-no-sku",
        ambiguous: isAmbiguous,
        ambiguityReason: isAmbiguous
          ? "Multiple legacy ProductChannelMapping rows point to the same Shopee product from different WMS products."
          : null,
        alreadyMapped: false,
      });
    }
  }

  const proposedCandidates = candidates.filter(
    (c) => c.proposedSalesSkuId && !c.ambiguous && !c.alreadyMapped,
  ).length;

  return {
    candidates,
    summary: {
      totalLegacyRows: legacyRows.length,
      proposedCandidates,
      ambiguousRows,
      skippedRows,
      alreadyMappedRows,
      noSkuMatchRows,
    },
  };
}
