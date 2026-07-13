/**
 * Shopify OAuth — Generate Authorization URL
 * GET /api/shopify/auth?shop=mystore.myshopify.com
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { isShopifyConfigured, getShopifyAuthUrl, generateState, isValidShopDomain } from "@/lib/shopify";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isShopifyConfigured()) {
      return NextResponse.json(
        { error: "Shopify integration is not configured. Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, and SHOPIFY_REDIRECT_URL." },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const shop = searchParams.get("shop");

    if (!shop) {
      return NextResponse.json(
        { error: "Missing required query parameter: shop" },
        { status: 400 },
      );
    }

    if (!isValidShopDomain(shop)) {
      return NextResponse.json(
        { error: "Invalid Shopify store domain. Must match {store}.myshopify.com" },
        { status: 400 },
      );
    }

    const state = generateState(session.id, shop);
    const authUrl = getShopifyAuthUrl(shop, state);

    return NextResponse.json({ url: authUrl, state });
  } catch (error) {
    logger.error("[Shopify Auth] Error generating auth URL:", error);
    return NextResponse.json(
      { error: "Failed to generate authorization URL" },
      { status: 500 },
    );
  }
}
