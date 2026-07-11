/**
 * TikTok Shop API — HMAC-SHA256 Signing
 * Adapted from official TikTok Shop Node.js SDK (utils/generate-sign.ts).
 *
 * Sign string format:
 *   {app_secret}{path}{sorted_key1}{value1}{sorted_key2}{value2}...{body}{app_secret}
 * → HMAC-SHA256(app_secret, signString) → hex
 */

import { createHmac } from "crypto";

const EXCLUDE_KEYS = new Set(["sign", "access_token"]);

/**
 * Generate HMAC-SHA256 signature for a TikTok Shop API request.
 *
 * @param path - The API request path (e.g. "/product/202502/products/search")
 * @param params - Query parameters (will be filtered, sorted, concatenated)
 * @param body - Optional JSON request body (will be stringified and appended)
 * @param appSecret - The app secret used as HMAC key
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function generateSign(
  path: string,
  params: Record<string, string>,
  body: string | null,
  appSecret: string,
): string {
  // Step 1: Filter and sort query parameters
  const sortedParams = Object.keys(params)
    .filter((key) => !EXCLUDE_KEYS.has(key))
    .sort()
    .map((key) => ({ key, value: params[key] }));

  // Step 2: Concatenate as {key}{value} pairs
  const paramString = sortedParams
    .map(({ key, value }) => `${key}${value}`)
    .join("");

  // Step 3: Prepend path
  let signString = `${path}${paramString}`;

  // Step 4: Append body if present (not multipart)
  if (body) {
    signString += body;
  }

  // Step 5: Wrap with app_secret
  signString = `${appSecret}${signString}${appSecret}`;

  // Step 6: HMAC-SHA256
  const hmac = createHmac("sha256", appSecret);
  hmac.update(signString);
  return hmac.digest("hex");
}
