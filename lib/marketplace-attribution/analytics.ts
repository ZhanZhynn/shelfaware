import prisma from "@/prisma/client";
import { safelyNormalizedUnits } from "./normalization";
import { resolveShopeeProductId } from "./shopee-identity";
import { aggregateConvertToReporting, type AggregatedConversion, type NativeLineAmount } from "./fx-conversion";

type NativeMoney = { minorUnits: string; scale: number };
type Row = { salesSkuId: string; familyId: string | null; salesSkuCode: string; salesSkuName: string; familyName: string | null; offerUnits: number; baseEquivalentUnits: number; nativeRevenueByCurrency: Record<string, NativeMoney>; mappedLines: number; recipeCoveredLines: number; mixedRecipeLines: number };

const currencyScale = (currency: string) => ({ JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3 }[currency.toUpperCase()] ?? 2);
const toMinorUnits = (value: number, currency: string) => BigInt(Math.round(value * 10 ** currencyScale(currency)));
const addNativeMoney = (buckets: Record<string, NativeMoney>, currency: string, value: number) => {
  const bucket = buckets[currency] ?? { minorUnits: "0", scale: currencyScale(currency) };
  bucket.minorUnits = (BigInt(bucket.minorUnits) + toMinorUnits(value, currency)).toString();
  buckets[currency] = bucket;
};

export function mappingIdentity(shopId: string, offerKey: string) { return `${shopId}:${offerKey}`; }
// Shopee documents 0 as the no-model sentinel. Older syncs stored it instead
// of null, so both representations identify the verified product offer.
export function shopeeOfferKeyForLine(productId: number, modelId: number | null) {
  return modelId == null || modelId === 0 ? `shopee:${productId}:product` : `shopee:${productId}:${modelId}`;
}
export function isUnverifiableLegacyNonvariantLine(modelId: number | null, productId: number | null) {
  return (modelId == null || modelId === 0) && productId == null;
}
export function resolveEffectiveMapping<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(mappings: T[], occurredAt: Date) {
  return mappings.find((mapping) => mapping.effectiveFrom <= occurredAt && (!mapping.effectiveTo || mapping.effectiveTo >= occurredAt));
}

export async function getCrossChannelPerformance(from: Date, to: Date, options?: { useFacts?: boolean; reportingCurrency?: string }) {
  if (options?.useFacts) {
    try {
      return await getCrossChannelPerformanceFromFacts(from, to, options?.reportingCurrency);
    } catch {
      // Fall through to live snapshot path
    }
  }
  const mappings = await prisma.marketplaceSkuMapping.findMany({ where: { platform: "shopee", effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { salesSku: { include: { familyMemberships: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { productFamily: true } }, recipes: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { components: true } } } } } });
  const mappingByOffer = new Map<string, typeof mappings>();
  for (const mapping of mappings) { const key = mappingIdentity(mapping.shopId, mapping.offerKey); mappingByOffer.set(key, [...(mappingByOffer.get(key) ?? []), mapping]); }
  const [items, products] = await Promise.all([
    prisma.shopeeOrderItem.findMany({ where: { order: { shopeeCreatedAt: { gte: from, lte: to }, orderStatus: { notIn: ["CANCELLED", "UNPAID"] } } }, select: { quantity: true, subtotal: true, shopeeItemId: true, shopeeModelId: true, sku: true, productName: true, variant: { select: { shopeeItemId: true } }, order: { select: { shopId: true, currency: true, shopeeCreatedAt: true } } } }),
    prisma.shopeeProduct.findMany({ where: { variants: { none: {} } }, select: { shopId: true, shopeeItemId: true, itemSku: true } }),
  ]);
  const productsByShop = new Map<string, typeof products>();
  for (const product of products) productsByShop.set(product.shopId, [...(productsByShop.get(product.shopId) ?? []), product]);
  const rows = new Map<string, Row>(); const allLines: NativeLineAmount[] = []; let totalReliableShopeeLines = 0; let mappedLines = 0; let recipeCoveredLines = 0; let mixedRecipeLines = 0; let unverifiableLegacyLines = 0; let familyAttributionExcludedLines = 0;
  for (const item of items) {
    const occurredAt = item.order.shopeeCreatedAt;
    const legacyNonvariant = item.shopeeModelId == null || item.shopeeModelId === 0;
    const productId = item.shopeeItemId ?? item.variant?.shopeeItemId ?? (legacyNonvariant ? resolveShopeeProductId(item, productsByShop.get(item.order.shopId) ?? []) : null);
    if (!occurredAt || productId == null) { if (isUnverifiableLegacyNonvariantLine(item.shopeeModelId, productId)) unverifiableLegacyLines++; continue; }
    totalReliableShopeeLines++;
    const offerKey = shopeeOfferKeyForLine(productId, item.shopeeModelId);
    const mapping = resolveEffectiveMapping(mappingByOffer.get(mappingIdentity(item.order.shopId, offerKey)) ?? [], occurredAt);
    if (!mapping) continue;
    mappedLines++;
    const membership = mapping.salesSku.familyMemberships.find((value) => value.effectiveFrom <= occurredAt && (!value.effectiveTo || value.effectiveTo >= occurredAt));
    if (!membership) familyAttributionExcludedLines++;
    const family = membership?.productFamily;
    const rowKey = `${mapping.salesSkuId}:${family?.id ?? "unassigned"}`;
    const row = rows.get(rowKey) ?? { salesSkuId: mapping.salesSkuId, familyId: family?.id ?? null, salesSkuCode: mapping.salesSku.code, salesSkuName: mapping.salesSku.name, familyName: family?.name ?? null, offerUnits: 0, baseEquivalentUnits: 0, nativeRevenueByCurrency: {}, mappedLines: 0, recipeCoveredLines: 0, mixedRecipeLines: 0 };
    row.offerUnits += item.quantity; row.mappedLines++;
    const recipe = mapping.salesSku.recipes.find((value) => value.effectiveFrom <= occurredAt && (!value.effectiveTo || value.effectiveTo >= occurredAt));
    const normalized = safelyNormalizedUnits(item.quantity, recipe?.components);
    if (normalized.covered && normalized.units != null) { row.baseEquivalentUnits += normalized.units; row.recipeCoveredLines++; recipeCoveredLines++; }
    if (normalized.mixed) { row.mixedRecipeLines++; mixedRecipeLines++; }
    addNativeMoney(row.nativeRevenueByCurrency, item.order.currency ?? "UNKNOWN", item.subtotal);
    const currency = item.order.currency ?? "UNKNOWN";
    allLines.push({ nativeMinor: toMinorUnits(item.subtotal, currency), currency, saleDate: occurredAt });
    rows.set(rowKey, row);
  }
  const familyRows = new Map<string, Omit<Row, "salesSkuId" | "salesSkuCode" | "salesSkuName">>();
  for (const row of rows.values()) { if (!row.familyId || !row.familyName) continue; const family = familyRows.get(row.familyId) ?? { familyId: row.familyId, familyName: row.familyName, offerUnits: 0, baseEquivalentUnits: 0, nativeRevenueByCurrency: {}, mappedLines: 0, recipeCoveredLines: 0, mixedRecipeLines: 0 }; family.offerUnits += row.offerUnits; family.baseEquivalentUnits += row.baseEquivalentUnits; family.mappedLines += row.mappedLines; family.recipeCoveredLines += row.recipeCoveredLines; family.mixedRecipeLines += row.mixedRecipeLines; for (const [currency, amount] of Object.entries(row.nativeRevenueByCurrency)) { const bucket = family.nativeRevenueByCurrency[currency] ?? { minorUnits: "0", scale: amount.scale }; bucket.minorUnits = (BigInt(bucket.minorUnits) + BigInt(amount.minorUnits)).toString(); family.nativeRevenueByCurrency[currency] = bucket; } familyRows.set(row.familyId, family); }

  if (!options?.reportingCurrency) {
    return { period: { from: from.toISOString(), to: to.toISOString() }, platform: "shopee", rows: [...rows.values()], familyRows: [...familyRows.values()], coverage: { totalReliableShopeeLines, mappedLines, unmappedLines: totalReliableShopeeLines - mappedLines, unverifiableLegacyLines, familyAttributionExcludedLines, recipeCoveredLines, mixedRecipeLines, excludedPlatforms: ["lazada", "tiktok"], reportingCurrency: null, note: "Native revenue is grouped in integer minor units by currency. Only verifiable Shopee lines are included in mapping coverage; legacy non-variant lines without a unique same-shop catalog match are excluded rather than guessed. Mapped lines without an effective-dated family membership retain offer-level revenue but are excluded from family rollups rather than attributed using the current family. Base-equivalent units exclude mixed-component recipes; no exchange-rate conversion is applied." } };
  }

  const conversion = await aggregateConvertToReporting(allLines, options.reportingCurrency);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    platform: "shopee",
    rows: [...rows.values()],
    familyRows: [...familyRows.values()],
    reportingCurrency: options.reportingCurrency,
    convertedRevenue: { minorUnits: conversion.reportingMinorTotal.toString(), scale: currencyScale(options.reportingCurrency) },
    conversionCoverage: {
      ...conversion.coverage,
      excludedCurrencies: Object.fromEntries(
        Object.entries(conversion.coverage.excludedCurrencies).map(([k, v]) => [k, { count: v.count, nativeMinorTotal: v.nativeMinorTotal.toString() }]),
      ),
    },
    coverage: {
      totalReliableShopeeLines,
      mappedLines,
      unmappedLines: totalReliableShopeeLines - mappedLines,
      unverifiableLegacyLines,
      familyAttributionExcludedLines,
      recipeCoveredLines,
      mixedRecipeLines,
      excludedPlatforms: ["lazada", "tiktok"],
      reportingCurrency: options.reportingCurrency,
      note: "Native revenue is grouped in integer minor units by currency. Only verifiable Shopee lines are included in mapping coverage; legacy non-variant lines without a unique same-shop catalog match are excluded rather than guessed. Mapped lines without an effective-dated family membership retain offer-level revenue but are excluded from family rollups rather than attributed using the current family. Base-equivalent units exclude mixed-component recipes.",
    },
  };
}

export async function getCrossChannelPerformanceFromFacts(from: Date, to: Date, reportingCurrency?: string) {
  const skuFacts = await prisma.salesSkuPerformanceFact.findMany({
    where: { saleDate: { gte: from, lte: to } },
    include: {
      sourceLine: { select: { platform: true, internalShopId: true, marketplaceQuantity: true, currency: true } },
    },
  });

  if (skuFacts.length === 0) throw new Error("No persisted facts found for this period.");

  const mappings = await prisma.marketplaceSkuMapping.findMany({
    where: { platform: "shopee", id: { in: [...new Set(skuFacts.map((f) => f.mappingId))] } },
    include: { salesSku: { include: { familyMemberships: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { productFamily: true } }, recipes: { where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { components: true } } } } },
  });
  const mappingById = new Map(mappings.map((m) => [m.id, m]));

  const rows = new Map<string, Row>();
  let totalReliableShopeeLines = 0;
  let mappedLines = 0;
  let recipeCoveredLines = 0;
  let mixedRecipeLines = 0;
  let familyAttributionExcludedLines = 0;

  for (const fact of skuFacts) {
    totalReliableShopeeLines++;
    mappedLines++;
    const mapping = mappingById.get(fact.mappingId);
    if (!mapping) continue;

    const occurredAt = fact.saleDate;
    const membership = mapping.salesSku.familyMemberships.find((m) => m.effectiveFrom <= occurredAt && (!m.effectiveTo || m.effectiveTo >= occurredAt));
    if (!membership) familyAttributionExcludedLines++;
    const family = membership?.productFamily;

    const rowKey = `${fact.salesSkuId}:${family?.id ?? "unassigned"}`;
    const row = rows.get(rowKey) ?? {
      salesSkuId: fact.salesSkuId,
      familyId: family?.id ?? null,
      salesSkuCode: mapping.salesSku.code,
      salesSkuName: mapping.salesSku.name,
      familyName: family?.name ?? null,
      offerUnits: 0,
      baseEquivalentUnits: 0,
      nativeRevenueByCurrency: {},
      mappedLines: 0,
      recipeCoveredLines: 0,
      mixedRecipeLines: 0,
    };

    const qty = fact.marketplaceUnits ?? 0;
    row.offerUnits += qty;
    row.mappedLines++;

    const recipe = mapping.salesSku.recipes.find((r) => r.effectiveFrom <= occurredAt && (!r.effectiveTo || r.effectiveTo >= occurredAt));
    const normalized = safelyNormalizedUnits(qty, recipe?.components);
    if (normalized.covered && normalized.units != null) { row.baseEquivalentUnits += normalized.units; row.recipeCoveredLines++; recipeCoveredLines++; }
    if (normalized.mixed) { row.mixedRecipeLines++; mixedRecipeLines++; }

    const currency = fact.currency;
    const bucket = row.nativeRevenueByCurrency[currency] ?? { minorUnits: "0", scale: fact.amountScale };
    bucket.minorUnits = (BigInt(bucket.minorUnits) + BigInt(fact.nativeAmountMinor)).toString();
    row.nativeRevenueByCurrency[currency] = bucket;

    rows.set(rowKey, row);
  }

  const familyRows = new Map<string, Omit<Row, "salesSkuId" | "salesSkuCode" | "salesSkuName">>();
  for (const row of rows.values()) {
    if (!row.familyId || !row.familyName) continue;
    const family = familyRows.get(row.familyId) ?? { familyId: row.familyId, familyName: row.familyName, offerUnits: 0, baseEquivalentUnits: 0, nativeRevenueByCurrency: {}, mappedLines: 0, recipeCoveredLines: 0, mixedRecipeLines: 0 };
    family.offerUnits += row.offerUnits;
    family.baseEquivalentUnits += row.baseEquivalentUnits;
    family.mappedLines += row.mappedLines;
    family.recipeCoveredLines += row.recipeCoveredLines;
    family.mixedRecipeLines += row.mixedRecipeLines;
    for (const [currency, amount] of Object.entries(row.nativeRevenueByCurrency)) {
      const bucket = family.nativeRevenueByCurrency[currency] ?? { minorUnits: "0", scale: amount.scale };
      bucket.minorUnits = (BigInt(bucket.minorUnits) + BigInt(amount.minorUnits)).toString();
      family.nativeRevenueByCurrency[currency] = bucket;
    }
    familyRows.set(row.familyId, family);
  }

  if (!reportingCurrency) {
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      platform: "shopee",
      source: "persisted-facts" as const,
      rows: [...rows.values()],
      familyRows: [...familyRows.values()],
      coverage: {
        totalReliableShopeeLines,
        mappedLines,
        unmappedLines: totalReliableShopeeLines - mappedLines,
        unverifiableLegacyLines: 0,
        familyAttributionExcludedLines,
        recipeCoveredLines,
        mixedRecipeLines,
        excludedPlatforms: ["lazada", "tiktok"],
        reportingCurrency: null,
        note: "Data sourced from persisted projection facts.",
      },
    };
  }

  const allLines: NativeLineAmount[] = skuFacts.map((fact) => ({
    nativeMinor: BigInt(fact.nativeAmountMinor),
    currency: fact.currency,
    saleDate: fact.saleDate,
  }));

  const conversion = await aggregateConvertToReporting(allLines, reportingCurrency);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    platform: "shopee",
    source: "persisted-facts" as const,
    rows: [...rows.values()],
    familyRows: [...familyRows.values()],
    reportingCurrency,
    convertedRevenue: { minorUnits: conversion.reportingMinorTotal.toString(), scale: currencyScale(reportingCurrency) },
    conversionCoverage: {
      ...conversion.coverage,
      excludedCurrencies: Object.fromEntries(
        Object.entries(conversion.coverage.excludedCurrencies).map(([k, v]) => [k, { count: v.count, nativeMinorTotal: v.nativeMinorTotal.toString() }]),
      ),
    },
    coverage: {
      totalReliableShopeeLines,
      mappedLines,
      unmappedLines: totalReliableShopeeLines - mappedLines,
      unverifiableLegacyLines: 0,
      familyAttributionExcludedLines,
      recipeCoveredLines,
      mixedRecipeLines,
      excludedPlatforms: ["lazada", "tiktok"],
      reportingCurrency,
      note: "Data sourced from persisted projection facts.",
    },
  };
}
