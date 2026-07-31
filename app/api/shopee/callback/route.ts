/**
 * Shopee OAuth — Callback Handler
 * GET /api/shopee/callback?code=...&shop_id=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { exchangeCodeForToken, getShopeeShopInfo, setActiveShop } from "@/lib/shopee";
import { prisma } from "@/prisma/client";
import { shopeeCallbackQuerySchema } from "@/lib/validations/shopee";
import { logger } from "@/lib/logger";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";
import { invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.id;
    const { searchParams } = new URL(request.url);

    const params = {
      code: searchParams.get("code") || "",
      shop_id: searchParams.get("shop_id") || "",
      state: searchParams.get("state") || undefined,
    };

    const validationResult = shopeeCallbackQuerySchema.safeParse(params);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid callback parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { code, shop_id } = validationResult.data;

    // Set active shop before token exchange so token storage resolves correctly
    setActiveShop(shop_id);

    // Exchange code for token
    const token = await exchangeCodeForToken(code, shop_id);
    if (!token) {
      return NextResponse.json(
        { error: "Failed to exchange authorization code for token" },
        { status: 500 },
      );
    }

    // Get shop info
    const shopInfo = await getShopeeShopInfo();

    // Upsert ShopeeShop record
    const existingShop = await prisma.shopeeShop.findFirst({
      where: { userId, shopId: shop_id },
    });

    if (existingShop) {
      await prisma.shopeeShop.update({
        where: { id: existingShop.id },
        data: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenExpiry: token.expired_at ? new Date(token.expired_at) : null,
          shopName: shopInfo?.shop_name || existingShop.shopName,
          shopStatus: shopInfo?.status || existingShop.shopStatus,
          region: shopInfo?.region || existingShop.region,
          merchantId: shopInfo?.merchant_id || existingShop.merchantId,
          isCb: shopInfo?.is_cb ?? existingShop.isCb,
          expireTime: shopInfo?.expire_time
            ? new Date(shopInfo.expire_time * 1000)
            : existingShop.expireTime,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.shopeeShop.create({
        data: {
          userId,
          shopId: shop_id,
          shopName: shopInfo?.shop_name || `Shop ${shop_id}`,
          shopStatus: shopInfo?.status || "active",
          region: shopInfo?.region || "GLOBAL",
          merchantId: shopInfo?.merchant_id || null,
          isCb: shopInfo?.is_cb ?? null,
          expireTime: shopInfo?.expire_time
            ? new Date(shopInfo.expire_time * 1000)
            : null,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenExpiry: token.expired_at ? new Date(token.expired_at) : null,
          createdBy: userId,
        },
      });
    }
    await invalidateMarketplaceAnalytics("shopee");

    logger.info(`[Shopee Auth] Shop ${shop_id} connected for user ${userId}`);

    // Redirect to admin Shopee page
    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(
      new URL("/admin/shopee", baseUrl),
    );
  } catch (error) {
    logger.error("[Shopee Callback] Error:", error);
    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(
      new URL("/admin/shopee?error=callback_failed", baseUrl),
    );
  }
}
