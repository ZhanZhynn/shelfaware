import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { generateAndUploadQRCode } from "@/lib/imagekit";
import { z } from "zod";

const createWmsProductSchema = z.object({
  shopeeProductId: z.string().min(1, "Shopee product ID is required"),
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
});

const bulkCreateSchema = z.object({
  shopeeProductIds: z.array(z.string()).min(1, "At least one product is required"),
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
});

function calculateProductStatus(quantity: number): string {
  if (quantity <= 0) return "Stock Out";
  if (quantity <= 20) return "Stock Low";
  return "Available";
}

function generateVariantSku(shopeeItemId: number, modelId: number): string {
  return `SHOPEE-${shopeeItemId}-${modelId}`;
}

interface ShopeeProductInput {
  id: string;
  itemName: string;
  shopeeItemId: number;
  itemSku: string | null;
  price: number;
  stock: number;
  imageUrl: string | null;
  variants: { id: string; modelId: number; modelName: string; modelSku: string | null; price: number; stock: number }[];
}

interface CreateResult {
  created: { product: { id: string; name: string; sku: string }; mapping: { id: string; channelProductId: string; channelType: string } }[];
  skipped: number;
  errors: string[];
}

async function createWmsProductsForShopeeProduct(
  shopeeProduct: ShopeeProductInput,
  categoryId: string,
  supplierId: string,
  userId: string,
): Promise<CreateResult> {
  // Determine which items to create
  const hasVariants = shopeeProduct.variants.length > 0;
  const itemsToCreate = hasVariants
    ? shopeeProduct.variants.map((v) => ({
        name: `${shopeeProduct.itemName} - ${v.modelName}`,
        sku: v.modelSku || generateVariantSku(shopeeProduct.shopeeItemId, v.modelId),
        price: v.price,
        stock: v.stock,
        channelProductId: v.id,
        channelType: "variant" as const,
      }))
    : [{
        name: shopeeProduct.itemName,
        sku: shopeeProduct.itemSku || generateVariantSku(shopeeProduct.shopeeItemId, 0),
        price: shopeeProduct.price,
        stock: shopeeProduct.stock,
        channelProductId: shopeeProduct.id,
        channelType: "product" as const,
      }];

  // Batch-check: find existing SKUs and existing mappings
  const allSkus = itemsToCreate.map((i) => i.sku);
  const allChannelIds = itemsToCreate.map((i) => i.channelProductId);

  const [existingProducts, existingMappings] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: allSkus } },
      select: { sku: true },
    }),
    prisma.productChannelMapping.findMany({
      where: { channel: "shopee", channelProductId: { in: allChannelIds } },
      select: { channelProductId: true },
    }),
  ]);

  const existingSkuSet = new Set(existingProducts.map((p) => p.sku));
  const existingMappingSet = new Set(existingMappings.map((m) => m.channelProductId));

  // Filter to items that need creating
  const itemsToProcess = itemsToCreate.filter((item) => {
    if (existingMappingSet.has(item.channelProductId)) return false; // Already mapped
    if (existingSkuSet.has(item.sku)) return false; // SKU conflict
    return true;
  });

  const errors: string[] = [];
  itemsToCreate.forEach((item) => {
    if (existingSkuSet.has(item.sku) && !existingMappingSet.has(item.channelProductId)) {
      errors.push(`SKU "${item.sku}" already exists`);
    }
  });

  const skipped = itemsToCreate.length - itemsToProcess.length - errors.length;

  if (itemsToProcess.length === 0) {
    return { created: [], skipped, errors };
  }

  // Create all products + mappings in a transaction
  const created = await prisma.$transaction(async (tx) => {
    const results: CreateResult["created"] = [];

    for (const item of itemsToProcess) {
      const status = calculateProductStatus(item.stock);

      const product = await tx.product.create({
        data: {
          name: item.name,
          sku: item.sku,
          price: item.price,
          quantity: BigInt(item.stock) as any,
          reservedQuantity: BigInt(0) as any,
          status,
          userId,
          skuScopeId: userId,
          createdBy: userId,
          categoryId,
          supplierId,
          imageUrl: shopeeProduct.imageUrl || null,
          imageFileId: null,
          expirationDate: null,
          createdAt: new Date(),
          updatedAt: null,
        },
      });

      const mapping = await tx.productChannelMapping.create({
        data: {
          wmsProductId: product.id,
          channel: "shopee",
          channelProductId: item.channelProductId,
          channelType: item.channelType,
        },
      });

      results.push({
        product: { id: product.id, name: product.name, sku: product.sku },
        mapping: { id: mapping.id, channelProductId: mapping.channelProductId, channelType: mapping.channelType },
      });
    }

    return results;
  });

  // Fire-and-forget: audit log + QR codes (non-blocking)
  for (const item of created) {
    createAuditLog({
      userId,
      action: "create",
      entityType: "product",
      entityId: item.product.id,
    }).catch((err) => logger.error("Audit log failed", err));

    const qrData = JSON.stringify({ productId: item.product.id, sku: item.product.sku, name: item.product.name });
    generateAndUploadQRCode(qrData, `product-${item.product.id}`)
      .then(async (qrResult) => {
        await prisma.product.update({
          where: { id: item.product.id },
          data: { qrCodeUrl: qrResult.url, qrCodeFileId: qrResult.fileId },
        });
      })
      .catch((err) => logger.error("QR code generation failed", err));
  }

  return { created, skipped, errors };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "supplier") {
      return NextResponse.json(
        { error: "Suppliers cannot create products" },
        { status: 403 },
      );
    }

    const userId = session.id;
    const body = await request.json();

    // Check if this is a bulk request
    const isBulkRequest = Array.isArray(body.shopeeProductIds);

    if (isBulkRequest) {
      return handleBulkCreate(body, userId);
    }

    // Single product create
    const validationResult = createWmsProductSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: validationResult.error.errors },
        { status: 400 },
      );
    }

    const { shopeeProductId, categoryId, supplierId } = validationResult.data;

    // Validate category and supplier
    const [category, supplier] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true, name: true } }),
      prisma.supplier.findFirst({ where: { id: supplierId, userId }, select: { id: true, name: true } }),
    ]);

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 400 });
    }

    // Fetch Shopee product (verify ownership)
    const shopeeProduct = await prisma.shopeeProduct.findFirst({
      where: { id: shopeeProductId, userId },
      include: { variants: true },
    });

    if (!shopeeProduct) {
      return NextResponse.json(
        { error: "Shopee product not found" },
        { status: 404 },
      );
    }

    const { created, skipped, errors } = await createWmsProductsForShopeeProduct(
      shopeeProduct,
      categoryId,
      supplierId,
      userId,
    );

    if (created.length === 0) {
      return NextResponse.json(
        { error: errors.length > 0 ? errors[0] : "No new products to create", skipped, errors },
        { status: 409 },
      );
    }

    logger.info("WMS product(s) created from Shopee listing", {
      userId,
      shopeeProductId,
      count: created.length,
      skipped,
    });

    return NextResponse.json(
      {
        products: created.map((c) => c.product),
        mappings: created.map((c) => c.mapping),
        skipped,
        errors,
        categoryName: category?.name,
        supplierName: supplier?.name,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Failed to create WMS product from Shopee", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleBulkCreate(body: unknown, userId: string) {
  const validationResult = bulkCreateSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: validationResult.error.errors },
      { status: 400 },
    );
  }

  const { shopeeProductIds, categoryId, supplierId } = validationResult.data;

  // Validate category and supplier
  const [category, supplier] = await Promise.all([
    prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true, name: true } }),
    prisma.supplier.findFirst({ where: { id: supplierId, userId }, select: { id: true, name: true } }),
  ]);

  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 400 });
  }
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 400 });
  }

  // Fetch all Shopee products (verify ownership)
  const shopeeProducts = await prisma.shopeeProduct.findMany({
    where: { id: { in: shopeeProductIds }, userId },
    include: { variants: true },
  });

  if (shopeeProducts.length === 0) {
    return NextResponse.json(
      { error: "No valid Shopee products found" },
      { status: 404 },
    );
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];

  for (const sp of shopeeProducts) {
    const { created, skipped, errors } = await createWmsProductsForShopeeProduct(
      sp,
      categoryId,
      supplierId,
      userId,
    );
    totalCreated += created.length;
    totalSkipped += skipped;
    allErrors.push(...errors.map((e) => `${sp.itemName}: ${e}`));
  }

  logger.info("Bulk WMS product creation from Shopee", {
    userId,
    requested: shopeeProductIds.length,
    created: totalCreated,
    skipped: totalSkipped,
  });

  return NextResponse.json(
    {
      created: totalCreated,
      skipped: totalSkipped,
      errors: allErrors,
    },
    { status: 201 },
  );
}

// GET: Check mapping status for Shopee products (variant-aware)
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const shopeeProductIds = searchParams.get("ids")?.split(",").filter(Boolean) || [];

    if (shopeeProductIds.length === 0) {
      return NextResponse.json({ mappings: [] });
    }

    // Fetch all Shopee products with variants
    const shopeeProducts = await prisma.shopeeProduct.findMany({
      where: { id: { in: shopeeProductIds } },
      include: { variants: { select: { id: true } } },
    });

    // Collect all channel product IDs (parent + variants)
    const allChannelProductIds: string[] = [];
    for (const sp of shopeeProducts) {
      allChannelProductIds.push(sp.id);
      for (const v of sp.variants) {
        allChannelProductIds.push(v.id);
      }
    }

    // Fetch all relevant mappings
    const mappings = await prisma.productChannelMapping.findMany({
      where: {
        channel: "shopee",
        channelProductId: { in: allChannelProductIds },
      },
      select: {
        channelProductId: true,
        wmsProductId: true,
        channelType: true,
      },
    });

    const mappingByChannelProductId = new Map(
      mappings.map((m) => [m.channelProductId, m]),
    );

    // Build status per parent product
    const statusMap = shopeeProductIds.map((id) => {
      const sp = shopeeProducts.find((p) => p.id === id);
      if (!sp) {
        return { shopeeProductId: id, isMapped: false, variantCount: 0, mappedVariantCount: 0, wmsProductId: undefined };
      }

      const variantCount = sp.variants.length || 1;
      let mappedVariantCount = 0;
      let firstMappedWmsProductId: string | undefined;

      // Check parent-level mapping
      const parentMapping = mappingByChannelProductId.get(sp.id);
      if (parentMapping) {
        mappedVariantCount = variantCount;
        firstMappedWmsProductId = parentMapping.wmsProductId;
      } else {
        // Check variant-level mappings
        for (const v of sp.variants) {
          const variantMapping = mappingByChannelProductId.get(v.id);
          if (variantMapping) {
            mappedVariantCount++;
            if (!firstMappedWmsProductId) {
              firstMappedWmsProductId = variantMapping.wmsProductId;
            }
          }
        }
      }

      const isFullyMapped = mappedVariantCount >= variantCount;

      return {
        shopeeProductId: id,
        isMapped: isFullyMapped,
        variantCount,
        mappedVariantCount,
        wmsProductId: firstMappedWmsProductId,
      };
    });

    return NextResponse.json({ mappings: statusMap });
  } catch (error) {
    logger.error("Failed to check mapping status", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
