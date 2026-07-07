/**
 * Generic HMAC verification utilities for marketplace webhook handlers.
 * Extracted from Shopee webhook handler for cross-marketplace reuse.
 */

import crypto from "crypto";

/**
 * Verify an HMAC-SHA256 hex signature using timing-safe comparison.
 * Returns false if signature is missing, secret is unset, or comparison fails.
 */
export function verifyHmacSha256Hex(
  body: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}
