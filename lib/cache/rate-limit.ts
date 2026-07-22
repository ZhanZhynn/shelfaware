/**
 * Rate Limiting Utilities
 * Redis-based rate limiting with sliding window algorithm
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  /**
   * Maximum number of requests allowed
   */
  limit: number;
  /**
   * Time window in seconds
   */
  window: number;
  /**
   * Identifier for the rate limit (e.g., user ID, IP address)
   */
  identifier: string;
  /** Use the bounded local limiter when Redis is unavailable or errors. */
  strict?: boolean;
}

const MAX_FALLBACK_IDENTIFIERS = 10_000;
const strictFallbackRequests = new Map<string, number[]>();

function checkStrictFallback(config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.window * 1000;
  const requests = (strictFallbackRequests.get(config.identifier) ?? []).filter((time) => time > windowStart);

  if (!strictFallbackRequests.has(config.identifier) && strictFallbackRequests.size >= MAX_FALLBACK_IDENTIFIERS) {
    for (const [identifier, entries] of strictFallbackRequests) {
      if (!entries.some((time) => time > windowStart)) strictFallbackRequests.delete(identifier);
    }
    if (strictFallbackRequests.size >= MAX_FALLBACK_IDENTIFIERS) {
      strictFallbackRequests.delete(strictFallbackRequests.keys().next().value!);
    }
  }

  if (requests.length >= config.limit) {
    strictFallbackRequests.set(config.identifier, requests);
    return { allowed: false, current: requests.length, limit: config.limit, reset: Math.max(1, Math.ceil(((requests[0] ?? now) + config.window * 1000 - now) / 1000)) };
  }

  requests.push(now);
  strictFallbackRequests.set(config.identifier, requests);
  return { allowed: true, current: requests.length, limit: config.limit, reset: config.window };
}

export function resetStrictRateLimitFallbackForTests() {
  strictFallbackRequests.clear();
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean;
  /**
   * Current request count in the window
   */
  current: number;
  /**
   * Maximum allowed requests
   */
  limit: number;
  /**
   * Time remaining until the window resets (in seconds)
   */
  reset: number;
}

/**
 * Check rate limit using sliding window algorithm
 *
 * @param config - Rate limit configuration
 * @returns Promise<RateLimitResult> - Rate limit result
 */
export async function checkRateLimit(
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    if (config.strict) return checkStrictFallback(config);
    // Non-sensitive endpoints retain graceful degradation when Redis is unavailable.
    logger.warn("Redis not available, rate limiting disabled");
    return {
      allowed: true,
      current: 0,
      limit: config.limit,
      reset: config.window,
    };
  }

  try {
    const key = `rate-limit:${config.identifier}`;
    const now = Date.now();
    const windowStart = now - config.window * 1000;

    // Use sorted set for sliding window
    // Remove old entries outside the window
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count current entries in the window
    const current = await redis.zcard(key);

    if (current >= config.limit) {
      // Rate limit exceeded
      const oldestEntry = await redis.zrange(key, 0, 0, {
        withScores: true,
      }) as Array<{ member: string; score: number }>;
      const resetTime = oldestEntry.length > 0 && oldestEntry[0]
        ? Math.ceil((oldestEntry[0].score + config.window * 1000 - now) / 1000)
        : config.window;

      return {
        allowed: false,
        current,
        limit: config.limit,
        reset: Math.max(0, resetTime),
      };
    }

    // Add current request to the window
    await redis.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    // Set expiration for the key (cleanup after window expires)
    await redis.expire(key, config.window);

    return {
      allowed: true,
      current: current + 1,
      limit: config.limit,
      reset: config.window,
    };
  } catch (error) {
    logger.error("Rate limit check failed:", error);
    if (config.strict) return checkStrictFallback(config);
    // Graceful degradation: allow request on error
    return {
      allowed: true,
      current: 0,
      limit: config.limit,
      reset: config.window,
    };
  }
}

/**
 * Get rate limit status without incrementing the counter
 *
 * @param identifier - Rate limit identifier
 * @param limit - Maximum allowed requests
 * @param window - Time window in seconds
 * @returns Promise<RateLimitResult> - Rate limit status
 */
export async function getRateLimitStatus(
  identifier: string,
  limit: number,
  window: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    return {
      allowed: true,
      current: 0,
      limit,
      reset: window,
    };
  }

  try {
    const key = `rate-limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - window * 1000;

    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count current entries
    const current = await redis.zcard(key);

    const oldestEntry = (await redis.zrange(key, 0, 0, {
      withScores: true,
    })) as Array<{ member: string; score: number }>;
    const resetTime = oldestEntry.length > 0 && oldestEntry[0]
      ? Math.ceil((oldestEntry[0].score + window * 1000 - now) / 1000)
      : window;

    return {
      allowed: current < limit,
      current,
      limit,
      reset: Math.max(0, resetTime),
    };
  } catch (error) {
    logger.error("Rate limit status check failed:", error);
    return {
      allowed: true,
      current: 0,
      limit,
      reset: window,
    };
  }
}
