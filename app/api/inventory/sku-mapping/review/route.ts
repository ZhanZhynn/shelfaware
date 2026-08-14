import { NextRequest, NextResponse } from "next/server";
import prisma from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { canViewSharedAttribution } from "@/lib/marketplace-attribution/access";
import { canMutateSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { confirmMapping } from "@/lib/marketplace-attribution/service";

const pageSize = 20;

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = request.nextUrl.searchParams.get("state") ?? "all";
  const search = (request.nextUrl.searchParams.get("search") ?? "").trim().toLowerCase();
  const requestedPage = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1") || 1);
  const [candidates, mappings, products, shops, catalog] = await Promise.all([
    prisma.marketplaceSkuCandidate.findMany({
      where: { platform: "shopee", status: "open" },
      select: {
        id: true, shopId: true, offerKey: true, externalProductId: true,
        externalVariantId: true, offerKind: true, normalizedSku: true,
        proposedSalesSkuId: true, draftSalesSkuId: true, draftedAt: true, confidence: true,
      },
    }),
    prisma.marketplaceSkuMapping.findMany({
      where: { platform: "shopee", effectiveTo: null },
      select: {
        id: true, shopId: true, offerKey: true, effectiveFrom: true,
        salesSku: { select: { id: true, code: true, name: true, family: { select: { name: true } } } },
      },
    }),
    prisma.shopeeProduct.findMany({
      select: {
        shopId: true, shopeeItemId: true, itemName: true, itemSku: true,
        imageUrl: true, status: true,
        variants: { select: { modelId: true, modelName: true, modelSku: true, stock: true, status: true } },
      },
      orderBy: { itemName: "asc" },
    }),
    prisma.shopeeShop.findMany({ select: { id: true, shopId: true, shopName: true } }),
    prisma.salesSku.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, family: { select: { name: true } } },
      orderBy: { code: "asc" },
    }),
  ]);
  const catalogById = new Map(catalog.map((sku) => [sku.id, sku]));
  const recipeSkuIds = [...new Set([
    ...candidates.flatMap((candidate) => [candidate.proposedSalesSkuId, candidate.draftSalesSkuId]),
    ...mappings.map((mapping) => mapping.salesSku.id),
  ].filter((id): id is string => Boolean(id)))];
  const recipes = recipeSkuIds.length
    ? await prisma.salesSkuRecipe.findMany({
        where: {
          salesSkuId: { in: recipeSkuIds }, status: "confirmed",
          effectiveFrom: { lte: new Date() },
        },
        include: { components: { include: { product: { select: { sku: true, name: true } } } } },
        orderBy: { effectiveFrom: "desc" },
      })
    : [];
  const recipeBySkuId = new Map<string, (typeof recipes)[number]>();
  for (const recipe of recipes) if (!recipeBySkuId.has(recipe.salesSkuId)) recipeBySkuId.set(recipe.salesSkuId, recipe);
  const withRecipe = <T extends { id: string }>(sku: T | null) => {
    if (!sku) return null;
    const recipe = recipeBySkuId.get(sku.id);
    return {
      ...sku,
      recipe: recipe?.components.map((component) => ({
        quantity: component.quantity,
        sku: component.product.sku,
        name: component.product.name,
      })) ?? [],
    };
  };
  const candidateByOffer = new Map(candidates.map((candidate) => [`${candidate.shopId}:${candidate.offerKey}`, candidate]));
  const mappingByOffer = new Map(mappings.map((mapping) => [`${mapping.shopId}:${mapping.offerKey}`, mapping]));
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));
  const rows = products.flatMap((product) => {
    const variants = product.variants.length
      ? product.variants.map((variant) => ({
          candidate: candidateByOffer.get(`${product.shopId}:shopee:${product.shopeeItemId}:${variant.modelId}`),
          mapping: mappingByOffer.get(`${product.shopId}:shopee:${product.shopeeItemId}:${variant.modelId}`),
          modelId: String(variant.modelId), name: variant.modelName,
          rawSku: variant.modelSku ?? product.itemSku ?? "", stock: variant.stock, status: variant.status,
        }))
      : [{
          candidate: candidateByOffer.get(`${product.shopId}:shopee:${product.shopeeItemId}:product`),
          mapping: mappingByOffer.get(`${product.shopId}:shopee:${product.shopeeItemId}:product`),
          modelId: null, name: "Default", rawSku: product.itemSku ?? "", stock: null, status: product.status,
        }];
    const reviewVariants = variants
      .filter((variant) => Boolean(variant.candidate || variant.mapping))
      .map((variant) => ({
        ...variant,
        proposedSalesSku: variant.candidate?.proposedSalesSkuId
          ? withRecipe(catalogById.get(variant.candidate.proposedSalesSkuId) ?? null)
          : null,
        state: variant.mapping ? "linked" : variant.candidate?.draftSalesSkuId ? "draft" : "unlinked",
        draftSalesSku: variant.candidate?.draftSalesSkuId
          ? withRecipe(catalogById.get(variant.candidate.draftSalesSkuId) ?? null)
          : null,
        mapping: variant.mapping
          ? { ...variant.mapping, salesSku: withRecipe(variant.mapping.salesSku)! }
          : undefined,
      }));
    if (!reviewVariants.length) return [];
    const filteredVariants = state === "all" ? reviewVariants : reviewVariants.filter((variant) => variant.state === state);
    if (!filteredVariants.length) return [];
    const shop = shopById.get(product.shopId);
    const searchable = [product.itemName, product.itemSku, ...filteredVariants.flatMap((variant) => [variant.name, variant.rawSku, variant.candidate?.normalizedSku, variant.proposedSalesSku?.code, variant.mapping?.salesSku.code])]
      .filter(Boolean).join(" ").toLowerCase();
    if (search && !searchable.includes(search)) return [];
    return [{
      shop: { id: product.shopId, name: shop?.shopName ?? "Shopee shop", externalId: shop?.shopId ?? "" },
      listing: { itemId: String(product.shopeeItemId), name: product.itemName, rawSku: product.itemSku, imageUrl: product.imageUrl, status: product.status },
      variants: filteredVariants,
    }];
  });
  const totalParents = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalParents / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const draft = candidates.filter((candidate) => candidate.draftSalesSkuId).length;
  return NextResponse.json({
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    catalog,
    pagination: { page, pageSize, totalParents, totalPages },
    counts: { all: candidates.length + mappings.length, unlinked: candidates.length - draft, draft, linked: mappings.length },
  });
}

export async function POST(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canMutateSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { command?: string; links?: { candidateId: string; salesSkuId: string }[]; candidateId?: string };
  try {
    if (body.command === "save-drafts") {
      const links = body.links ?? [];
      if (!links.length) throw new Error("Select one or more complete listings first.");
      const skuIds = [...new Set(links.map((link) => link.salesSkuId))];
      const active = await prisma.salesSku.findMany({ where: { id: { in: skuIds }, active: true }, select: { id: true } });
      if (active.length !== skuIds.length) throw new Error("One or more selected Sitegiant iSKUs are inactive or unavailable.");
      await prisma.$transaction(async (tx) => {
        const results = await Promise.all(links.map((link) => tx.marketplaceSkuCandidate.updateMany({
          where: { id: link.candidateId, platform: "shopee", status: "open" },
          data: { draftSalesSkuId: link.salesSkuId, draftedAt: new Date(), draftedById: session.id },
        })));
        if (results.some((result) => result.count !== 1))
          throw new Error("One or more listings changed before they could be drafted. Refresh and retry.");
      });
      return NextResponse.json({ drafted: links.length });
    }
    if (body.command === "remove-draft") {
      if (!body.candidateId) throw new Error("A draft listing is required.");
      const updated = await prisma.marketplaceSkuCandidate.updateMany({
        where: { id: body.candidateId, platform: "shopee", status: "open", draftSalesSkuId: { not: null } },
        data: { draftSalesSkuId: null, draftedAt: null, draftedById: null },
      });
      if (updated.count !== 1) throw new Error("This listing is no longer an open draft.");
      return NextResponse.json({ removed: true });
    }
    if (body.command === "confirm-drafts") {
      const ids = body.links?.map((link) => link.candidateId) ?? [];
      const drafts = await prisma.marketplaceSkuCandidate.findMany({
        where: { ...(ids.length ? { id: { in: ids } } : {}), platform: "shopee", status: "open", draftSalesSkuId: { not: null } },
      });
      if (!drafts.length) throw new Error("There are no open draft listings to confirm.");
      const outcomes = [];
      for (const draft of drafts) {
        try {
          const mapping = await confirmMapping({
            platform: "shopee", shopId: draft.shopId, externalProductId: draft.externalProductId,
            externalVariantId: draft.externalVariantId ?? undefined,
            offerKind: draft.offerKind as "variant" | "verified-product",
            salesSkuId: draft.draftSalesSkuId!, candidateId: draft.id,
          }, session.id);
          outcomes.push({ candidateId: draft.id, mappingId: mapping.id });
        } catch (error) {
          outcomes.push({ candidateId: draft.id, error: error instanceof Error ? error.message : "Could not confirm draft." });
        }
      }
      return NextResponse.json({ outcomes });
    }
    return NextResponse.json({ error: "Unknown inventory-linking command." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update inventory linking." }, { status: 400 });
  }
}
