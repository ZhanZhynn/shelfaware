/**
 * Google OAuth Callback Route
 * Handles OAuth callback from Google and creates/authenticates user
 */

import { NextRequest, NextResponse } from "next/server";
import { generateToken } from "@/utils/auth";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  isGoogleOAuthConfigured,
} from "@/lib/auth/oauth";
import { logger } from "@/lib/logger";
import { generateUniqueUsername } from "@/lib/auth/unique-username";
import { prisma } from "@/prisma/client";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { notifyAdminsOfPendingRegistration } from "@/lib/notifications/in-app";
import { sendPendingRegistrationAdminEmail } from "@/lib/email/notifications";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";
import { hasSourcingAccess, safeSourcingDestination, sourcingDestination } from "@/lib/sourcing/portal";

/**
 * Helper to redirect to login with error/pending message and clear OAuth cookies.
 * Ensures oauth_state and oauth_callback cookies are always cleaned up.
 */
function redirectToLogin(request: NextRequest, path: string): NextResponse {
  const baseUrl = getRequestBaseUrl(request);
  const response = NextResponse.redirect(new URL(path, baseUrl));
  response.cookies.delete("oauth_state");
  response.cookies.delete("oauth_callback");
  return response;
}

type GoogleOAuthProfile = {
  email: string;
  name?: string | null;
  googleId: string;
  userImage: string | null;
};

/** Create OAuth user with unique username; recover from P2002 race / username collision */
async function createGoogleOAuthUser(
  profile: GoogleOAuthProfile,
): Promise<User> {
  const { email, name, googleId, userImage } = profile;
  const randomPassword = Buffer.from(Math.random().toString(36)).toString(
    "base64",
  );
  const hashedPassword = await bcrypt.hash(randomPassword, 10);
  const username = await generateUniqueUsername(
    email.split("@")[0] || name || "user",
  );

  const displayName = name?.trim() || email.split("@")[0] || "user";

  const createData = {
    email,
    name: displayName,
    password: hashedPassword,
    googleId,
    image: userImage,
    role: "user",
    status: "pending",
    username,
    createdAt: new Date(),
  };

  try {
    return await prisma.user.create({ data: createData });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return existing;
      }
      const retryUsername = await generateUniqueUsername(
        `${username}${Date.now().toString(36).slice(-4)}`,
      );
      return await prisma.user.create({
        data: { ...createData, username: retryUsername },
      });
    }
    throw error;
  }
}

/** Merge Google profile into an existing user when fields are missing */
async function updateGoogleOAuthUser(
  user: User,
  profile: GoogleOAuthProfile,
): Promise<User> {
  const { googleId, userImage, name } = profile;
  const updateData: {
    googleId?: string;
    image?: string | null;
    name?: string;
  } = {};

  if (!user.googleId) {
    updateData.googleId = googleId;
  }
  if (userImage && userImage !== user.image) {
    updateData.image = userImage;
  }
  if (name && name !== user.name && !user.name) {
    updateData.name = name;
  }

  if (Object.keys(updateData).length === 0) {
    return user;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });
}

/**
 * GET /api/auth/oauth/google/callback
 * Handle Google OAuth callback
 * Creates user if doesn't exist, then authenticates
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.auth,
    );
    if (rateLimitResponse) return rateLimitResponse;

    if (!isGoogleOAuthConfigured()) {
      return redirectToLogin(request, "/login?error=oauth_not_configured");
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Check for OAuth errors — access_denied means the user cancelled the Google consent screen;
    // this is expected UX, not a system error, so it must not be sent to Sentry
    if (error) {
      if (error !== "access_denied") {
        // Only log unexpected OAuth errors (e.g. server_error from Google)
        logger.warn("Google OAuth error:", error);
      }
      return redirectToLogin(request, "/login?error=oauth_failed");
    }

    // Validate state (CSRF protection)
    const storedState = request.cookies.get("oauth_state")?.value;
    if (!state || !storedState || state !== storedState) {
      logger.error("OAuth state mismatch - possible CSRF attack");
      return redirectToLogin(request, "/login?error=invalid_state");
    }

    if (!code) {
      return redirectToLogin(request, "/login?error=no_code");
    }

    // Exchange authorization code for access token
    const clientId = getGoogleClientId()!;
    const clientSecret = getGoogleClientSecret()!;
    const baseUrl = getRequestBaseUrl(request);
    const redirectUri = new URL(
      "/api/auth/oauth/google/callback",
      baseUrl
    ).toString();

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        logger.error("Failed to exchange OAuth code for token:", errorData);
        return redirectToLogin(request, "/login?error=token_exchange_failed");
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Get user info from Google
      const userInfoResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!userInfoResponse.ok) {
        logger.error("Failed to fetch user info from Google");
        return redirectToLogin(request, "/login?error=fetch_user_failed");
      }

      const googleUser = await userInfoResponse.json();
      // Extract user data from Google OAuth response
      // Note: Google uses 'picture' field, but we map it to 'image' for consistency
      const { id: googleId, email, name, picture: googleImage } = googleUser;

      if (!email) {
        logger.error("Google user info missing email");
        return redirectToLogin(request, "/login?error=no_email");
      }

      // Map Google's 'picture' field to our 'image' field for consistency
      const userImage = googleImage || null;

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { email },
      });

      const profile: GoogleOAuthProfile = {
        email,
        name,
        googleId,
        userImage,
      };

      if (!user) {
        user = await createGoogleOAuthUser(profile);
        logger.info(`New user created via Google OAuth: ${email}`);
        const { invalidateAllServerCaches } = await import("@/lib/cache");
        await invalidateAllServerCaches().catch(() => {});
        // Notify admins about the pending registration (non-blocking)
        notifyAdminsOfPendingRegistration(name || email, email).catch((err) => {
          logger.warn("Failed to notify admins of pending OAuth registration", { error: err });
        });
        sendPendingRegistrationAdminEmail(name || email, email).catch((err) => {
          logger.warn("Failed to email admins about pending OAuth registration", { error: err });
        });
      } else {
        user = await updateGoogleOAuthUser(user, profile);
      }

      if (!user.id) {
        logger.error("User data corrupted: id missing");
        return redirectToLogin(request, "/login?error=user_data_error");
      }

      // Check account status (approval gate)
      // Legacy users without status field default to "approved"
      const userStatus = user.status ?? "approved";
      if (userStatus === "pending") {
        return redirectToLogin(request, "/login?pending=1");
      }
      if (userStatus === "rejected") {
        return redirectToLogin(request, "/login?error=rejected");
      }

      // Generate JWT token
      const token = generateToken(user.id);
      if (!token) {
        logger.error("Failed to generate token");
        return redirectToLogin(request, "/login?error=token_generation_failed");
      }

      // Redirect to role-appropriate page directly (avoids double-redirect chain through /)
       const callback = request.cookies.get("oauth_callback")?.value;
       const wantsSourcing = callback?.startsWith("/sourcing") || callback?.startsWith("/admin/sourcing");
       const roleDest = wantsSourcing
         ? (await hasSourcingAccess(user) ? (user.role === "admin" ? sourcingDestination(user) : safeSourcingDestination(callback)) : "/login/sourcing?error=no_sourcing_access")
         :
        user.role === "client"
          ? "/client"
          : user.role === "supplier"
            ? "/supplier"
            : "/";

      const redirectUrl = new URL(roleDest, baseUrl);
      redirectUrl.searchParams.set("oauth_success", "true");

      // Create response and set cookies
      const response = NextResponse.redirect(redirectUrl);

      // Set session cookie
      response.cookies.set("session_id", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });

      // Clear OAuth cookies
      response.cookies.delete("oauth_state");
      response.cookies.delete("oauth_callback");

      const { invalidateAllServerCaches } = await import("@/lib/cache");
      await invalidateAllServerCaches().catch(() => {});

      logger.info(`User authenticated via Google OAuth: ${email}`);
      return response;
    } catch (error) {
      logger.error("Error processing Google OAuth callback:", error);
      return redirectToLogin(request, "/login?error=oauth_processing_failed");
    }
  } catch (error) {
    logger.error("Error in Google OAuth callback:", error);
    return redirectToLogin(request, "/login?error=oauth_error");
  }
}
