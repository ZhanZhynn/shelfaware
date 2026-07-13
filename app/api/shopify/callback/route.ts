/**
 * Shopify OAuth — Callback Handler
 * GET /api/shopify/callback?code=...&hmac=...&host=...&shop=...&state=...&timestamp=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import {
  verifyState,
  validateShopifyHmac,
  isTimestampFresh,
  exchangeCodeForToken,
  fetchShopInfo,
  persistShopConnection,
} from "@/lib/shopify";
import { shopifyCallbackQuerySchema } from "@/lib/validations/shopify";
import { logger } from "@/lib/logger";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Convert URLSearchParams to Record<string, string>
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const validationResult = shopifyCallbackQuerySchema.safeParse(params);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid callback parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { code, hmac, shop, state, timestamp } = validationResult.data;

    // 1. Verify state (CSRF protection)
    const stateData = verifyState(state);
    if (!stateData) {
      const baseUrl = getRequestBaseUrl(request);
      return NextResponse.redirect(new URL("/admin/shopify?error=invalid_state", baseUrl));
    }
    if (stateData.userId !== session.id) {
      const baseUrl = getRequestBaseUrl(request);
      return NextResponse.redirect(new URL("/admin/shopify?error=state_mismatch", baseUrl));
    }

    // 2. Validate timestamp freshness
    if (timestamp && !isTimestampFresh(timestamp)) {
      const baseUrl = getRequestBaseUrl(request);
      return NextResponse.redirect(new URL("/admin/shopify?error=expired_timestamp", baseUrl));
    }

    // 3. Validate HMAC signature
    if (!validateShopifyHmac(params, hmac)) {
      const baseUrl = getRequestBaseUrl(request);
      return NextResponse.redirect(new URL("/admin/shopify?error=invalid_hmac", baseUrl));
    }

    // 4. Exchange code for access token
    const tokenData = await exchangeCodeForToken(shop, code);
    if (!tokenData?.access_token) {
      const baseUrl = getRequestBaseUrl(request);
      return NextResponse.redirect(new URL("/admin/shopify?error=token_exchange_failed", baseUrl));
    }

    // 5. Fetch shop info
    const shopInfo = await fetchShopInfo(shop, tokenData.access_token);
    const shopName = shopInfo?.name || shop.replace(".myshopify.com", "");

    // 6. Persist connection
    await persistShopConnection(
      session.id,
      shop,
      shopName,
      tokenData.access_token,
      tokenData.scope,
    );

    logger.info(`[Shopify Callback] Shop ${shop} connected for user ${session.id}`);

    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(new URL("/admin/shopify", baseUrl));
  } catch (error) {
    logger.error("[Shopify Callback] Error:", error);
    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(new URL("/admin/shopify?error=callback_failed", baseUrl));
  }
}
