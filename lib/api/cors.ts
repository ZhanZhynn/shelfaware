/**
 * CORS Utility
 * Centralized CORS handling for API routes
 * Supports dynamic origin validation for development and production
 */

import type { NextRequest } from "next/server";
import { trustedBrowserOrigins } from "@/lib/security/browser-request";

/**
 * Production URL
 */
function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const configuredOrigin =
  toOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
  toOrigin(process.env.AUTH_URL) ||
  toOrigin(process.env.NEXTAUTH_URL);
const PRODUCTION_URL = configuredOrigin || "https://console-web.shelfaware.my";

/**
 * Check if an origin is allowed for CORS
 * Allows localhost for development and production URL for production
 * @param origin - The origin header from the request
 * @returns true if origin is allowed, false otherwise
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try { return trustedBrowserOrigins().has(origin); } catch { return false; }
}

/**
 * Get the allowed origin for CORS response
 * Returns the origin if allowed, otherwise returns production URL
 * @param origin - The origin header from the request
 * @returns The allowed origin string
 */
export function getAllowedOrigin(origin: string | null): string {
  if (origin && isAllowedOrigin(origin)) {
    return origin;
  }
  return PRODUCTION_URL;
}

/**
 * Create CORS headers for API responses
 * @param request - The Next.js request object
 * @returns Headers object with CORS configuration
 */
export function createCorsHeaders(request: NextRequest): Headers {
  const origin = request.headers.get("origin");
  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", getAllowedOrigin(origin));
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");

  return headers;
}

/**
 * Handle CORS preflight (OPTIONS) requests
 * @param request - The Next.js request object
 * @returns Response with CORS headers
 */
export function handleCorsPreflight(request: NextRequest): Response {
  const headers = createCorsHeaders(request);
  return new Response(null, { status: 200, headers });
}
