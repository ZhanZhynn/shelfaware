import prisma from "@/prisma/client";
import { createHash } from "crypto";
import { resolveEffectiveMapping } from "./analytics";

const CALCULATION_VERSION = "v1";

export type SourceLineForProjection = {
  id: string;
  platform: string;
  internalShopId: string;
  externalOrderId: string;
  externalLineId: string;
  offerId: string | null;
  orderDate: Date;
  marketplaceQuantity: number | null;
  grossItemSalesMinor: string | null;
  amountScale: number;
  currency: string;
  orderEligibility: string;
  sourceRevision: string | null;
};

function projectionKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 64);
}

function offerFactKey(line: SourceLineForProjection) {
  return projectionKey("offer", line.platform, line.internalShopId, line.externalOrderId, line.externalLineId, line.sourceRevision ?? "", CALCULATION_VERSION);
}

function salesSkuFactKey(line: SourceLineForProjection, mappingId: string) {
  return projectionKey("sku", line.platform, line.internalShopId, line.externalOrderId, line.externalLineId, line.sourceRevision ?? "", mappingId, CALCULATION_VERSION);
}

function wmsFactKey(line: SourceLineForProjection, mappingId: string, recipeId: string, wmsProductId: string) {
  return projectionKey("wms", line.platform, line.internalShopId, line.externalOrderId, line.externalLineId, line.sourceRevision ?? "", mappingId, recipeId, wmsProductId, CALCULATION_VERSION);
}

export function allocateGmvMinor(gmvMinor: bigint, basisPoints: number, totalBasisPoints: number): bigint {
  return (gmvMinor * BigInt(basisPoints)) / BigInt(totalBasisPoints);
}

export function distributeResidual(
  gmvMinor: bigint,
  allocations: { basisPoints: number; position: number }[],
): bigint[] {
  const totalBasisPoints = allocations.reduce((sum, a) => sum + a.basisPoints, 0);
  if (totalBasisPoints === 0) return allocations.map(() => 0n);

  const amounts = allocations.map((a) => allocateGmvMinor(gmvMinor, a.basisPoints, totalBasisPoints));
  const allocated = amounts.reduce((sum, a) => sum + a, 0n);
  const residual = gmvMinor - allocated;

  if (residual !== 0n) {
    let maxPositionIdx = 0;
    for (let i = 1; i < allocations.length; i++) {
      if (allocations[i]!.position > allocations[maxPositionIdx]!.position) maxPositionIdx = i;
    }
    amounts[maxPositionIdx] = (amounts[maxPositionIdx] ?? 0n) + residual;
  }

  return amounts;
}

type RecipeComponent = { productId: string; quantity: number };
type Recipe = { id: string; effectiveFrom: Date; effectiveTo: Date | null; components: RecipeComponent[] };

export function resolveRecipeForDate(recipes: Recipe[], date: Date): Recipe | null {
  return recipes.find((r) => r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date)) ?? null;
}

function offerKeyForIdentity(offer: { externalProductId: string; externalVariantId: string | null }) {
  return offer.externalVariantId ? `shopee:${offer.externalProductId}:${offer.externalVariantId}` : `shopee:${offer.externalProductId}:product`;
}

export async function projectFactsForSourceLines(sourceLineIds: string[]) {
  const sourceLines = await prisma.marketplaceSourceSalesLine.findMany({
    where: { id: { in: sourceLineIds }, orderEligibility: "eligible" },
  });

  if (!sourceLines.length) return { offerFacts: 0, salesSkuFacts: 0, wmsFacts: 0, skipped: sourceLineIds.length };

  const offerIds = [...new Set(sourceLines.map((l) => l.offerId).filter(Boolean) as string[])];
  const offers = await prisma.marketplaceOffer.findMany({
    where: { id: { in: offerIds } },
  });
  const offerById = new Map(offers.map((o) => [o.id, o]));

  const allShopIds = [...new Set(sourceLines.map((l) => l.internalShopId))];
  const mappings = await prisma.marketplaceSkuMapping.findMany({
    where: { platform: "shopee", shopId: { in: allShopIds } },
    orderBy: { effectiveFrom: "asc" },
  });

  const mappingsByShopOffer = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    const key = `${mapping.shopId}:${mapping.offerKey}`;
    const arr = mappingsByShopOffer.get(key) ?? [];
    arr.push(mapping);
    mappingsByShopOffer.set(key, arr);
  }

  const allSkuIds = [...new Set(mappings.map((m) => m.salesSkuId))];
  const recipes = await prisma.salesSkuRecipe.findMany({
    where: { salesSkuId: { in: allSkuIds }, status: "confirmed" },
    include: { components: true },
    orderBy: { effectiveFrom: "asc" },
  });

  const recipesBySkuId = new Map<string, Recipe[]>();
  for (const recipe of recipes) {
    const arr = recipesBySkuId.get(recipe.salesSkuId) ?? [];
    arr.push({
      id: recipe.id,
      effectiveFrom: recipe.effectiveFrom,
      effectiveTo: recipe.effectiveTo,
      components: recipe.components.map((c) => ({ productId: c.productId, quantity: c.quantity })),
    });
    recipesBySkuId.set(recipe.salesSkuId, arr);
  }

  let offerFacts = 0;
  let salesSkuFacts = 0;
  let wmsFacts = 0;

  for (const line of sourceLines) {
    if (!line.offerId) continue;

    const offer = line.offerId ? offerById.get(line.offerId) : null;

    const pkOffer = offerFactKey(line);
    await prisma.marketplaceOfferPerformanceFact.upsert({
      where: { projectionKey: pkOffer },
      create: {
        sourceLineId: line.id,
        offerId: line.offerId,
        projectionKey: pkOffer,
        quantity: line.marketplaceQuantity,
        nativeGmvMinor: line.grossItemSalesMinor,
        amountScale: line.amountScale,
        currency: line.currency,
        saleDate: line.orderDate,
        calculationVersion: CALCULATION_VERSION,
      },
      update: {
        quantity: line.marketplaceQuantity,
        nativeGmvMinor: line.grossItemSalesMinor,
        projectedAt: new Date(),
      },
    });
    offerFacts++;

    if (!offer) continue;

    const offerKey = offerKeyForIdentity(offer);
    const mappingKey = `${line.internalShopId}:${offerKey}`;
    const offerMappings = mappingsByShopOffer.get(mappingKey) ?? [];

    if (!offerMappings.length) continue;

    const effectiveMapping = resolveEffectiveMapping(offerMappings, line.orderDate);
    if (!effectiveMapping) continue;

    const pkSku = salesSkuFactKey(line, effectiveMapping.id);
    await prisma.salesSkuPerformanceFact.upsert({
      where: { projectionKey: pkSku },
      create: {
        sourceLineId: line.id,
        mappingId: effectiveMapping.id,
        salesSkuId: effectiveMapping.salesSkuId,
        projectionKey: pkSku,
        nativeAmountMinor: line.grossItemSalesMinor ?? "0",
        amountScale: line.amountScale,
        currency: line.currency,
        marketplaceUnits: line.marketplaceQuantity,
        saleDate: line.orderDate,
        calculationVersion: CALCULATION_VERSION,
      },
      update: {
        nativeAmountMinor: line.grossItemSalesMinor ?? "0",
        marketplaceUnits: line.marketplaceQuantity,
        projectedAt: new Date(),
      },
    });
    salesSkuFacts++;

    const skuRecipes = recipesBySkuId.get(effectiveMapping.salesSkuId) ?? [];
    const effectiveRecipe = resolveRecipeForDate(skuRecipes, line.orderDate);
    if (!effectiveRecipe?.components.length) continue;
    if (!line.grossItemSalesMinor || line.marketplaceQuantity == null) continue;

    const gmvMinor = BigInt(line.grossItemSalesMinor);
    const components = effectiveRecipe.components;
    // MVP: equal-split allocation across recipe components. Each component gets
    // an equal share of the GMV (10000 / N basis points). This is intentionally
    // simple — proportional-to-quantity allocation (weighting each component's
    // share by its physical quantity) is a future enhancement tracked as a
    // follow-up once real multi-component recipes with varying quantities appear.
    const totalBasisPoints = 10000;
    const basisPerComponent = Math.floor(totalBasisPoints / components.length);
    const remainderBp = totalBasisPoints - basisPerComponent * components.length;

    const allocationInputs = components.map((c, i) => ({
      basisPoints: i === 0 ? basisPerComponent + remainderBp : basisPerComponent,
      position: i,
    }));

    const allocatedAmounts = distributeResidual(gmvMinor, allocationInputs);

    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      const allocatedMinor = allocatedAmounts[i]!;
      const normalizedUnits = line.marketplaceQuantity * component.quantity;

      const pkWms = wmsFactKey(line, effectiveMapping.id, effectiveRecipe.id, component.productId);
      await prisma.wmsProductSalesFact.upsert({
        where: { projectionKey: pkWms },
        create: {
          sourceLineId: line.id,
          mappingId: effectiveMapping.id,
          recipeId: effectiveRecipe.id,
          wmsProductId: component.productId,
          projectionKey: pkWms,
          normalizedUnits,
          allocatedGmvMinor: allocatedMinor.toString(),
          allocationBasisPoints: allocationInputs[i]!.basisPoints,
          amountScale: line.amountScale,
          currency: line.currency,
          saleDate: line.orderDate,
          calculationVersion: CALCULATION_VERSION,
        },
        update: {
          normalizedUnits,
          allocatedGmvMinor: allocatedMinor.toString(),
          allocationBasisPoints: allocationInputs[i]!.basisPoints,
          projectedAt: new Date(),
        },
      });
      wmsFacts++;
    }
  }

  return { offerFacts, salesSkuFacts, wmsFacts, skipped: sourceLineIds.length - sourceLines.length };
}
