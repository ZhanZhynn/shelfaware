/**
 * TikTok Shop OAuth — Callback Handler
 * GET /api/tiktok/callback?code=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { exchangeCodeForToken, getAuthorizedShops } from "@/lib/tiktok";
import prisma from "@/prisma/client";
import { tiktokCallbackQuerySchema } from "@/lib/validations/tiktok";
import { logger } from "@/lib/logger";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";

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
      state: searchParams.get("state") || undefined,
    };

    const validationResult = tiktokCallbackQuerySchema.safeParse(params);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid callback parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { code } = validationResult.data;

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code);
    if (!tokenData || !tokenData.access_token) {
      return NextResponse.json(
        { error: "Failed to exchange authorization code for token" },
        { status: 500 },
      );
    }

    // Get authorized shops (to obtain shop_cipher)
    const shops = await getAuthorizedShops(tokenData.access_token);
    if (!shops || shops.length === 0) {
      return NextResponse.json(
        { error: "No shops found in authorization response" },
        { status: 500 },
      );
    }

    // Use the first shop
    const shopInfo = shops[0]!;

    // Compute token expiry dates
    const now = new Date();
    const accessTokenExpiry = tokenData.access_token_expire_in
      ? new Date(tokenData.access_token_expire_in * 1000)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const refreshTokenExpiry = tokenData.refresh_token_expire_in
      ? new Date(tokenData.refresh_token_expire_in * 1000)
      : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    // Upsert TikTokShop record
    const existingShop = await prisma.tikTokShop.findFirst({
      where: { userId, shopId: shopInfo.id },
    });

    if (existingShop) {
      await prisma.tikTokShop.update({
        where: { id: existingShop.id },
        data: {
          shopCipher: shopInfo.cipher,
          shopName: shopInfo.name,
          region: shopInfo.region,
          sellerType: shopInfo.seller_type,
          shopCode: shopInfo.code,
          openId: tokenData.open_id || null,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpiry: accessTokenExpiry,
          refreshExpiry: refreshTokenExpiry,
          updatedAt: now,
        },
      });
    } else {
      await prisma.tikTokShop.create({
        data: {
          userId,
          shopId: shopInfo.id,
          shopCipher: shopInfo.cipher,
          shopName: shopInfo.name,
          region: shopInfo.region,
          sellerType: shopInfo.seller_type,
          shopCode: shopInfo.code,
          openId: tokenData.open_id || null,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpiry: accessTokenExpiry,
          refreshExpiry: refreshTokenExpiry,
          createdBy: userId,
        },
      });
    }

    logger.info(`[TikTok Auth] Shop ${shopInfo.name} (${shopInfo.id}) connected for user ${userId}`);

    // Redirect to admin TikTok page
    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(new URL("/admin/tiktok", baseUrl));
  } catch (error) {
    logger.error("[TikTok Callback] Error:", error);
    const baseUrl = getRequestBaseUrl(request);
    return NextResponse.redirect(
      new URL("/admin/tiktok?error=callback_failed", baseUrl),
    );
  }
}
