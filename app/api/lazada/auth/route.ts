/**
 * Lazada OAuth — Generate Authorization URL
 * GET /api/lazada/auth
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { isLazadaConfigured, getLazadaAuthUrl } from "@/lib/lazada";
import { getEnvVar } from "@/lib/env";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isLazadaConfigured()) {
      return NextResponse.json(
        { error: "Lazada integration is not configured. Set LAZADA_APP_KEY and LAZADA_APP_SECRET." },
        { status: 503 },
      );
    }

    const redirectUri = getEnvVar("LAZADA_REDIRECT_URL");
    if (!redirectUri) {
      return NextResponse.json(
        { error: "LAZADA_REDIRECT_URL is not configured" },
        { status: 500 },
      );
    }

    const authUrl = getLazadaAuthUrl(redirectUri);
    if (!authUrl) {
      return NextResponse.json(
        { error: "Failed to generate authorization URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: authUrl });
  } catch (error) {
    logger.error("[Lazada Auth] Error generating auth URL:", error);
    return NextResponse.json(
      { error: "Failed to generate authorization URL" },
      { status: 500 },
    );
  }
}
