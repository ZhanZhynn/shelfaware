/**
 * Next.js 16 Proxy — lightweight cookie-existence check.
 * Runs as a network boundary handler so unauthenticated visitors are
 * redirected to /login instantly without starting a serverless function.
 *
 * NO fetch / API call / JWT verification here; server components and
 * API routes handle full session validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestBaseUrl } from "@/lib/api/response-helpers";
import { safeMarketplaceConnectPath } from "@/lib/auth/marketplace-connect";
import { marketplaceConnectOrigin } from "@/lib/security/browser-request";

const PUBLIC = new Set(["/login", "/register"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.has(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get("session_id")?.value;
  if (!session || session === "null" || session === "undefined") {
    const connect = safeMarketplaceConnectPath(pathname + request.nextUrl.search);
    const baseUrl = marketplaceConnectOrigin(connect) ?? getRequestBaseUrl(request);
    const url = new URL("/login", baseUrl);
    if (connect) url.searchParams.set("redirect", connect);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.woff|.*\\.woff2).*)",
  ],
};
