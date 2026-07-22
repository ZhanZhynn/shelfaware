/**
 * Google OAuth API Routes
 * Handles Google OAuth authorization and callback
 */

import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthUrl, isGoogleOAuthConfigured } from "@/lib/auth/oauth";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";
import { safeSourcingDestination } from "@/lib/sourcing/routing";

/**
 * GET /api/auth/oauth/google
 * Initiate Google OAuth flow
 * Redirects user to Google OAuth consent screen
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.auth,
    );
    if (rateLimitResponse) return rateLimitResponse;

    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json(
        { error: "Google OAuth is not configured" },
        { status: 503 }
      );
    }

    // Generate state for CSRF protection
    const state = Buffer.from(
      Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
    ).toString("base64");

    // Get callback URL from query params or use default
    const { searchParams } = new URL(request.url);
    const requestedCallback = searchParams.get("callback");
    const callbackUrl = requestedCallback?.startsWith("/sourcing") || requestedCallback?.startsWith("/admin/sourcing")
      ? safeSourcingDestination(requestedCallback)
      : "/";
    const baseUrl = getRequestBaseUrl(request);
    const redirectUri = new URL(
      "/api/auth/oauth/google/callback",
      baseUrl
    ).toString();

    // Generate Google OAuth URL
    const oauthUrl = getGoogleOAuthUrl(redirectUri, state);
    if (!oauthUrl) {
      return NextResponse.json(
        { error: "Failed to generate OAuth URL" },
        { status: 500 }
      );
    }

    // Create response and set cookies before redirecting
    const response = NextResponse.redirect(oauthUrl);

    // Store state and callback in cookies for CSRF protection and redirect after auth
    response.cookies.set("oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });
    response.cookies.set("oauth_callback", callbackUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    // Redirect to Google OAuth
    return response;
  } catch (error) {
    logger.error("Error initiating Google OAuth:", error);
    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 }
    );
  }
}
