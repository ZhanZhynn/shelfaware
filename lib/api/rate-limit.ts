/**
 * API Rate Limiting Helper
 * Utilities for rate limiting in API route handlers
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, type RateLimitResult } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { trustedClientIdentifier } from "@/lib/security/client-ip";

/**
 * Rate limit configuration for API routes
 */
export interface ApiRateLimitConfig {
  /**
   * Maximum number of requests allowed per window
   */
  limit: number;
  /**
   * Time window in seconds
   */
  window: number;
  /**
   * Get identifier from request (e.g., user ID, IP address)
   */
  getIdentifier: (request: NextRequest) => string;
  /** Require the bounded in-process limiter if Redis is unavailable. */
  strictFallback?: boolean;
}

/**
 * Default rate limit configurations
 */
export const defaultRateLimits = {
  /**
   * Standard API rate limit (600 requests per minute per user/IP).
   * Each page navigation fires ~4-5 API calls; fast clicking 10+ pages should never 429.
   */
  standard: {
    limit: 600,
    window: 60,
    getIdentifier: (request: NextRequest) => {
      return trustedClientIdentifier(request.headers);
    },
  },
  /**
   * Strict rate limit (10 requests per minute)
   */
  strict: {
    limit: 30,
    window: 60,
    strictFallback: true,
    getIdentifier: (request: NextRequest) => {
      return trustedClientIdentifier(request.headers);
    },
  },
  /**
   * Auth rate limit (20 requests per minute)
   */
  auth: {
    limit: 20,
    window: 60,
    strictFallback: true,
    getIdentifier: (request: NextRequest) => {
      return trustedClientIdentifier(request.headers);
    },
  },
  authAccount: {
    limit: 10, window: 900, strictFallback: true,
    getIdentifier: (request: NextRequest) => trustedClientIdentifier(request.headers),
  },
} as const;

/**
 * Rate limit middleware for API routes
 * Returns NextResponse with rate limit headers if exceeded
 *
 * @param request - Next.js request object
 * @param config - Rate limit configuration
 * @param overrideIdentifier - Optional: use this instead of getIdentifier (e.g. session user id) for per-user limits
 * @returns Promise<NextResponse | null> - Error response if rate limited, null if allowed
 */
export async function withRateLimit(
  request: NextRequest,
  config: ApiRateLimitConfig,
  overrideIdentifier?: string
): Promise<NextResponse | null> {
  try {
    const identifier =
      overrideIdentifier != null
        ? `user:${overrideIdentifier}`
        : config.getIdentifier(request);
    const result = await checkRateLimit({
      limit: config.limit,
      window: config.window,
      identifier,
      strict: config.strictFallback,
    });

    // Add rate limit headers to response
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", config.limit.toString());
    headers.set("X-RateLimit-Remaining", Math.max(0, config.limit - result.current).toString());
    headers.set("X-RateLimit-Reset", (Date.now() / 1000 + result.reset).toString());

    if (!result.allowed) {
      headers.set("Retry-After", String(Math.max(1, Math.ceil(result.reset))));
      headers.set("Cache-Control", "no-store");
      logger.warn("Rate limit exceeded", { current: result.current, limit: config.limit, window: config.window });
      return NextResponse.json(
        {
          success: false,
          error: "Rate limit exceeded",
          message: `Too many requests. Please try again in ${result.reset} seconds.`,
          retryAfter: result.reset,
        },
        {
          status: 429,
          headers,
        }
      );
    }

    // Return null to indicate request is allowed
    // The actual response should include the rate limit headers
    return null;
  } catch (error) {
    logger.error("Rate limit check failed:", error);
    if (config.strictFallback) return NextResponse.json({ error: "Authentication rate limiter unavailable" }, { status: 503, headers: { "retry-after": "60" } });
    return null;
  }
}

/**
 * Add rate limit headers to response
 *
 * @param response - Next.js response object
 * @param result - Rate limit result
 * @param limit - Rate limit configuration
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
  limit: number
): void {
  response.headers.set("X-RateLimit-Limit", limit.toString());
  response.headers.set("X-RateLimit-Remaining", Math.max(0, limit - result.current).toString());
  response.headers.set("X-RateLimit-Reset", (Date.now() / 1000 + result.reset).toString());
}
