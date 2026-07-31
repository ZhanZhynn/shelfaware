/**
 * Shopee Excel Import — Upload and import orders from Shopee Seller Center Excel export
 * POST /api/shopee/import
 * Accepts multipart/form-data with an .xlsx file and a shopId field.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { parseExcelOrderFile, importExcelOrders } from "@/lib/shopee/excel-import";
import { prisma } from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateCache, cacheKeys, invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import { logger } from "@/lib/logger";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";

export async function POST(request: NextRequest) {
  try {
    // Rate limit: standard
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const ownerIds = await marketplaceOwnerIds(session);

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const shopId = formData.get("shopId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!shopId) {
      return NextResponse.json({ error: "Shop ID is required" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name || "";
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload an Excel file (.xlsx or .xls)" },
        { status: 400 },
      );
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB" },
        { status: 400 },
      );
    }

    // Ownership check — verify the user owns this shop
    const shop = await prisma.shopeeShop.findFirst({
      where: { id: shopId, userId: { in: ownerIds } },
      select: { id: true, shopId: true, shopName: true, userId: true },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Shop not found or you don't have access" },
        { status: 403 },
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));

    logger.info(
      `[Shopee Excel Import] User ${userId} uploading ${fileName} (${(file.size / 1024).toFixed(1)}KB) for shop ${shop.shopName}`,
    );

    // Parse Excel file
    const { orders, totalRows } = await parseExcelOrderFile(buffer);

    if (orders.size === 0) {
      return NextResponse.json(
        { error: "No valid orders found in the Excel file", details: `Parsed ${totalRows} rows, 0 orders` },
        { status: 400 },
      );
    }

    // Import orders into database
    const result = await importExcelOrders(orders, shopId, shop.userId, userId);

    // Invalidate cache after import
    await invalidateCache(cacheKeys.shopee.pattern);
    await invalidateMarketplaceAnalytics("shopee");

    logger.info(
      `[Shopee Excel Import] Completed for shop ${shop.shopName}: ${result.orders} orders, ${result.itemsCreated} items`,
    );

    return NextResponse.json({
      success: true,
      ...result,
      fileName,
      shopName: shop.shopName,
    });
  } catch (error) {
    logger.error("[Shopee Excel Import] Error:", error);
    return NextResponse.json(
      {
        error: "Import failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
