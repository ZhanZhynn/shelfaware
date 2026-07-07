/**
 * Generic retry with exponential backoff.
 * Extracted from Shopee ads rate-limit retry for cross-marketplace reuse.
 */

import { logger } from "@/lib/logger";

interface RetryOptions {
  /** Number of retry attempts (default 3) */
  retries?: number;
  /** Regex to match error messages that should trigger a retry */
  match?: RegExp;
  /** Base delay in ms for exponential backoff (default 1000) */
  baseDelayMs?: number;
  /** Context label for log messages */
  label?: string;
}

/**
 * Retry a function with exponential backoff on matching errors.
 * Non-matching errors are thrown immediately without retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    match = /rate_limit|too_many_requests|429/i,
    baseDelayMs = 1000,
    label = "API",
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const isRetryable =
        error instanceof Error && match.test(error.message);
      if (!isRetryable || attempt === retries) {
        throw error;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn(
        `[${label}] Rate limited (attempt ${attempt + 1}/${retries + 1}), retrying in ${delayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
