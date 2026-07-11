/**
 * TikTok Shop OAuth — Generate Authorization URL
 * GET /api/tiktok/auth
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { isTikTokConfigured, getTikTokAuthUrl } from "@/lib/tiktok";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isTikTokConfigured()) {
      return NextResponse.json(
        { error: "TikTok Shop integration is not configured. Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET." },
        { status: 503 },
      );
    }

    const redirectUri = getEnvVar("TIKTOK_REDIRECT_URL");
    if (!redirectUri) {
      return NextResponse.json(
        { error: "TIKTOK_REDIRECT_URL is not configured" },
        { status: 500 },
      );
    }

    const authUrl = getTikTokAuthUrl(redirectUri);
    if (!authUrl) {
      return NextResponse.json(
        { error: "Failed to generate authorization URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: authUrl });
  } catch (error) {
    logger.error("[TikTok Auth] Error generating auth URL:", error);
    return NextResponse.json(
      { error: "Failed to generate authorization URL" },
      { status: 500 },
    );
  }
}
