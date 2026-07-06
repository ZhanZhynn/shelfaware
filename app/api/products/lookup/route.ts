import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import type { ProductLookupResult } from "@/types/receiving";

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    const userId = session.id;
    let productId: string | undefined;
    let sku: string | undefined;

    // Try parsing as JSON (our QR payload format: {productId, sku, name})
    try {
      const parsed = JSON.parse(q);
      if (parsed && typeof parsed.productId === "string") {
        productId = parsed.productId;
        if (typeof parsed.sku === "string") sku = parsed.sku;
      }
    } catch {
      // Not JSON — treat as a raw SKU string
      sku = q.trim();
    }

    // Lookup by productId first, then by SKU
    let product: { id: string; sku: string; name: string; price: number; quantity: bigint; imageUrl: string | null } | null = null;

    if (productId) {
      product = await prisma.product.findFirst({
        where: { id: productId, userId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
        select: { id: true, sku: true, name: true, price: true, quantity: true, imageUrl: true },
      });
    }

    if (!product && sku) {
      product = await prisma.product.findFirst({
        where: { sku, userId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
        select: { id: true, sku: true, name: true, price: true, quantity: true, imageUrl: true },
      });
    }

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const result: ProductLookupResult = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      quantity: Number(product.quantity),
      imageUrl: product.imageUrl ?? undefined,
    };

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Product Lookup] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to lookup product" },
      { status: 500 },
    );
  }
}
