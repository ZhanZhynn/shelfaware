import prisma from "@/prisma/client";
import type { Prisma } from "@prisma/client";

const PRODUCT_SENTINEL = "product";

export function shopeeIdentityKey(shopId: string, shopeeItemId: number, modelId: number | null | undefined) {
  const variantPart = modelId == null || modelId === 0 ? PRODUCT_SENTINEL : String(modelId);
  return `shopee:${shopId}:${shopeeItemId}:${variantPart}`;
}

export async function upsertShopeeOffers(shopId: string) {
  const products = await prisma.shopeeProduct.findMany({
    where: { shopId },
    select: {
      id: true,
      shopId: true,
      shopeeItemId: true,
      itemName: true,
      itemSku: true,
      imageUrl: true,
      variants: {
        select: {
          id: true,
          modelId: true,
          modelName: true,
          modelSku: true,
        },
      },
    },
  });

  const results = { created: 0, updated: 0, total: 0 };

  for (const product of products) {
    if (product.variants.length === 0) {
      const identityKey = shopeeIdentityKey(shopId, product.shopeeItemId, null);
      await prisma.marketplaceOffer.upsert({
        where: { identityKey },
        create: {
          platform: "shopee",
          internalShopId: shopId,
          externalProductId: String(product.shopeeItemId),
          externalVariantId: null,
          identityKey,
          sellerSku: product.itemSku ?? null,
          productName: product.itemName,
          variantName: null,
          imageUrl: product.imageUrl ?? null,
        },
        update: {
          sellerSku: product.itemSku ?? null,
          productName: product.itemName,
          imageUrl: product.imageUrl ?? null,
          lastSeenAt: new Date(),
        },
      });
      results.total++;
      results.created++;
    } else {
      for (const variant of product.variants) {
        const identityKey = shopeeIdentityKey(shopId, product.shopeeItemId, variant.modelId);
        await prisma.marketplaceOffer.upsert({
          where: { identityKey },
          create: {
            platform: "shopee",
            internalShopId: shopId,
            externalProductId: String(product.shopeeItemId),
            externalVariantId: String(variant.modelId),
            identityKey,
            sellerSku: variant.modelSku ?? product.itemSku ?? null,
            productName: product.itemName,
            variantName: variant.modelName,
            imageUrl: product.imageUrl ?? null,
          },
          update: {
            sellerSku: variant.modelSku ?? product.itemSku ?? null,
            productName: product.itemName,
            variantName: variant.modelName,
            imageUrl: product.imageUrl ?? null,
            lastSeenAt: new Date(),
          },
        });
        results.total++;
        results.updated++;
      }
    }
  }

  return results;
}

export async function upsertShopeeOfferForItem(
  shopId: string,
  shopeeItemId: number,
  modelId: number | null | undefined,
  client: Pick<Prisma.TransactionClient, "marketplaceOffer"> = prisma,
) {
  const identityKey = shopeeIdentityKey(shopId, shopeeItemId, modelId);

  const product = await prisma.shopeeProduct.findFirst({
    where: { shopId, shopeeItemId },
    select: {
      itemName: true,
      itemSku: true,
      imageUrl: true,
      variants: modelId != null && modelId !== 0
        ? { where: { modelId }, select: { modelName: true, modelSku: true } }
        : undefined,
    },
  });

  if (!product) return null;

  const variant = modelId != null && modelId !== 0 ? product.variants?.[0] : null;

  return client.marketplaceOffer.upsert({
    where: { identityKey },
    create: {
      platform: "shopee",
      internalShopId: shopId,
      externalProductId: String(shopeeItemId),
      externalVariantId: modelId != null && modelId !== 0 ? String(modelId) : null,
      identityKey,
      sellerSku: variant?.modelSku ?? product.itemSku ?? null,
      productName: product.itemName,
      variantName: variant?.modelName ?? null,
      imageUrl: product.imageUrl ?? null,
    },
    update: {
      sellerSku: variant?.modelSku ?? product.itemSku ?? null,
      productName: product.itemName,
      variantName: variant?.modelName ?? null,
      imageUrl: product.imageUrl ?? null,
      lastSeenAt: new Date(),
    },
  });
}
