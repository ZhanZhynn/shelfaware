import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import {
  canMutateSharedAttribution,
  canViewSharedAttribution,
} from "@/lib/marketplace-attribution/access";
import {
  isSharedSkuMappingEnabled,
  isSharedSkuMappingMutationsEnabled,
} from "@/lib/marketplace-attribution/feature-flags";
import {
  confirmMapping,
  correctMapping,
  createRecipe,
  previewMapping,
  rejectCandidate,
} from "@/lib/marketplace-attribution/service";
import {
  normalizeCatalogCode,
  normalizeSku,
} from "@/lib/marketplace-attribution/intervals";
import { normalizeShopeeExternalId } from "@/lib/marketplace-attribution/shopee-external-id";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier.");
const mappingInputBase = z.object({
  platform: z.literal("shopee"),
  shopId: objectId,
  externalProductId: z.string().min(1),
  externalVariantId: z.string().min(1).optional(),
  offerKind: z.enum(["variant", "verified-product"]),
  salesSkuId: objectId,
  effectiveFrom: z.string().datetime().optional(),
  candidateId: objectId.optional(),
});

function validateMappingInput(
  value: z.infer<typeof mappingInputBase>,
  context: z.RefinementCtx,
) {
  if (value.offerKind === "variant" && !value.externalVariantId)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["externalVariantId"],
      message: "A variant mapping needs its stable external variant identity.",
    });
  if (value.offerKind === "verified-product" && value.externalVariantId)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["externalVariantId"],
      message: "Verified-product mappings use the product sentinel, not a variant identity.",
    });
}

const mappingInput = mappingInputBase.superRefine(validateMappingInput);
const previewMappingInput = mappingInputBase
  .extend({ excludeMappingId: objectId.optional() })
  .superRefine(validateMappingInput);

async function sessionFor(request: NextRequest, mutate = false) {
  const session = await getSessionFromRequest(request);
  if (!session)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  if (
    mutate
      ? !canMutateSharedAttribution(session)
      : !canViewSharedAttribution(session)
  )
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  return { session };
}

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  const access = await sessionFor(request);
  if (access.error) return access.error;
  const [families, mappings, candidates, offers] = await Promise.all([
    prisma.productFamily.findMany({
      include: {
        salesSkus: { where: { active: true }, orderBy: { code: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.marketplaceSkuMapping.findMany({
      include: {
        salesSku: { include: { family: true } },
        events: { orderBy: { occurredAt: "desc" } },
      },
      orderBy: { effectiveFrom: "desc" },
      take: 250,
    }),
    prisma.marketplaceSkuCandidate.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.shopeeProductVariant.findMany({
      select: {
        shopId: true,
        shopeeItemId: true,
        modelId: true,
        modelName: true,
        modelSku: true,
        itemSku: true,
        product: { select: { itemName: true } },
      },
      take: 250,
    }),
  ]);
  const knownOffers = new Set(
    mappings
      .filter((mapping) => !mapping.effectiveTo)
      .map((mapping) => `${mapping.shopId}:${mapping.offerKey}`),
  );
  const skuIndex = new Map(
    families.flatMap((family) =>
      family.salesSkus.map((sku) => [normalizeSku(sku.code), sku.id]),
    ),
  );
  const proposed = offers
    .filter(
      (offer) =>
        !knownOffers.has(
          `${offer.shopId}:shopee:${offer.shopeeItemId}:${offer.modelId}`,
        ),
    )
    .flatMap((offer) => {
      const normalizedSku = normalizeSku(offer.modelSku ?? offer.itemSku ?? "");
      const proposedSalesSkuId = skuIndex.get(normalizedSku);
      if (!normalizedSku || !proposedSalesSkuId) return [];
      return [
        {
          platform: "shopee",
          shopId: offer.shopId,
          offerKey: `shopee:${offer.shopeeItemId}:${offer.modelId}`,
          externalProductId: String(offer.shopeeItemId),
          externalVariantId: String(offer.modelId),
          offerKind: "variant",
          normalizedSku,
          proposedSalesSkuId,
          confidence: "exact-normalized-sku",
          label: `${offer.product.itemName} - ${offer.modelName}`,
        },
      ];
    });
  const persistedKeys = new Set(
    candidates.map((candidate) => `${candidate.shopId}:${candidate.offerKey}`),
  );
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  const recipes = await prisma.salesSkuRecipe.findMany({
    include: {
      salesSku: { select: { code: true } },
      components: {
        include: { product: { select: { sku: true, name: true } } },
      },
    },
    orderBy: { effectiveFrom: "desc" },
    take: 250,
  });
  return NextResponse.json({
    families,
    mappings,
    candidates: [
      ...candidates,
      ...proposed.filter(
        (candidate) =>
          !persistedKeys.has(`${candidate.shopId}:${candidate.offerKey}`),
      ),
    ],
    products,
    recipes,
  });
}

export async function POST(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  if (!isSharedSkuMappingMutationsEnabled())
    return NextResponse.json({ error: "Shared SKU mapping mutations are not enabled." }, { status: 403 });
  const access = await sessionFor(request, true);
  if (access.error) return access.error;
  const parsed = z
    .object({
      command: z.enum([
        "create-family",
        "create-sales-sku",
        "confirm-mapping",
        "preview-mapping",
        "correct-mapping",
        "reject-candidate",
        "create-recipe",
      ]),
      data: z.unknown(),
    })
    .safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    if (parsed.data.command === "create-family") {
      const data = z
        .object({
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(120),
          description: z.string().max(1000).optional(),
        })
        .parse(parsed.data.data);
      return NextResponse.json(
        await prisma.productFamily.create({
          data: {
            ...data,
            code: normalizeCatalogCode(data.code),
            createdById: access.session.id,
          },
        }),
        { status: 201 },
      );
    }
    if (parsed.data.command === "create-sales-sku") {
      const data = z
        .object({
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(160),
          familyId: objectId,
        })
        .parse(parsed.data.data);
      const family = await prisma.productFamily.findUnique({
        where: { id: data.familyId },
        select: { id: true, active: true },
      });
      if (!family?.active)
        throw new Error("The selected active Product Family does not exist.");
      return NextResponse.json(
        await prisma.salesSku.create({
          data: {
            ...data,
            code: normalizeCatalogCode(data.code),
            createdById: access.session.id,
            familyMemberships: {
              create: {
                productFamilyId: data.familyId,
                effectiveFrom: new Date(),
                createdById: access.session.id,
              },
            },
          },
        }),
        { status: 201 },
      );
    }
    if (parsed.data.command === "confirm-mapping") {
      const parsedInput = mappingInput.parse(parsed.data.data);
      const data = {
        ...parsedInput,
        externalProductId: normalizeShopeeExternalId(
          parsedInput.externalProductId,
        ),
        externalVariantId: parsedInput.externalVariantId
          ? normalizeShopeeExternalId(parsedInput.externalVariantId)
          : undefined,
      };
      return NextResponse.json(
        await confirmMapping(
          {
            ...data,
            effectiveFrom: data.effectiveFrom
              ? new Date(data.effectiveFrom)
              : undefined,
          },
          access.session.id,
        ),
        { status: 201 },
      );
    }
    if (parsed.data.command === "preview-mapping") {
      const parsedInput = previewMappingInput.parse(parsed.data.data);
      const data = {
        ...parsedInput,
        externalProductId: normalizeShopeeExternalId(
          parsedInput.externalProductId,
        ),
        externalVariantId: parsedInput.externalVariantId
          ? normalizeShopeeExternalId(parsedInput.externalVariantId)
          : undefined,
      };
      return NextResponse.json(
        await previewMapping({
          ...data,
          effectiveFrom: data.effectiveFrom
            ? new Date(data.effectiveFrom)
            : undefined,
        }),
      );
    }
    if (parsed.data.command === "correct-mapping") {
      const data = z
        .object({
          mappingId: objectId,
          salesSkuId: objectId,
          effectiveFrom: z.string().datetime(),
        })
        .parse(parsed.data.data);
      return NextResponse.json(
        await correctMapping(
          data.mappingId,
          data.salesSkuId,
          new Date(data.effectiveFrom),
          access.session.id,
        ),
        { status: 201 },
      );
    }
    if (parsed.data.command === "reject-candidate") {
      const data = z.object({ candidateId: objectId }).parse(parsed.data.data);
      return NextResponse.json(
        await rejectCandidate(data.candidateId, access.session.id),
      );
    }
    const data = z
      .object({
        salesSkuId: objectId,
        name: z.string().trim().min(1).max(160),
        effectiveFrom: z.string().datetime(),
        effectiveTo: z.string().datetime().optional(),
        components: z
          .array(
            z.object({
              productId: objectId,
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
      })
      .parse(parsed.data.data);
    return NextResponse.json(
      await createRecipe(
        {
          ...data,
          effectiveFrom: new Date(data.effectiveFrom),
          effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        },
        access.session.id,
      ),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save mapping.",
      },
      { status: 400 },
    );
  }
}
