/**
 * Lazada OAuth — Callback Handler
 * GET /api/lazada/callback?code=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { exchangeLazadaCodeForToken, persistTokens, setActiveSeller } from "@/lib/lazada/server";
import prisma from "@/prisma/client";
import { lazadaCallbackQuerySchema } from "@/lib/validations/lazada";
import { logger } from "@/lib/logger";

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

    const validationResult = lazadaCallbackQuerySchema.safeParse(params);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid callback parameters", details: validationResult.error.flatten() },
        { status: 400 },
      );
    }

    const { code } = validationResult.data;

    // Exchange code for token
    const token = await exchangeLazadaCodeForToken(code);
    if (!token || !token.access_token) {
      return NextResponse.json(
        { error: "Failed to exchange authorization code for token" },
        { status: 500 },
      );
    }

    // Extract seller info from token response
    const sellerInfo = token.country_user_info?.[0];
    const sellerId = sellerInfo?.seller_id;
    const country = token.country || "my";

    if (!sellerId) {
      return NextResponse.json(
        { error: "No seller info in token response" },
        { status: 500 },
      );
    }

    // Set active seller for token persistence
    setActiveSeller(sellerId);

    // Persist tokens
    await persistTokens(token);

    // Upsert LazadaShop record
    const now = new Date();
    const accessTokenExpiry = token.expires_in
      ? new Date(now.getTime() + token.expires_in * 1000)
      : null;
    const refreshTokenExpiry = token.refresh_expires_in
      ? new Date(now.getTime() + token.refresh_expires_in * 1000)
      : null;

    const existingShop = await prisma.lazadaShop.findFirst({
      where: { userId, sellerId },
    });

    if (existingShop) {
      await prisma.lazadaShop.update({
        where: { id: existingShop.id },
        data: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenExpiry: accessTokenExpiry,
          refreshExpiry: refreshTokenExpiry,
          countryCode: country,
          updatedAt: now,
        },
      });
    } else {
      await prisma.lazadaShop.create({
        data: {
          userId,
          sellerId,
          sellerName: token.account || `Seller ${sellerId}`,
          countryCode: country,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenExpiry: accessTokenExpiry,
          refreshExpiry: refreshTokenExpiry,
          createdBy: userId,
        },
      });
    }

    logger.info(`[Lazada Auth] Seller ${sellerId} connected for user ${userId}`);

    // Redirect to admin Lazada page
    return NextResponse.redirect(
      new URL("/admin/lazada", request.url),
    );
  } catch (error) {
    logger.error("[Lazada Callback] Error:", error);
    return NextResponse.redirect(
      new URL("/admin/lazada?error=callback_failed", request.url),
    );
  }
}
