import { NextResponse } from "next/server";
import { safeMarketplaceConnectPath } from "@/lib/auth/marketplace-connect";

type BrowserRequest = { headers: Headers; method?: string };
export const isBrowserWrite = (method?: string) => !!method && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

function configuredOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("Application origins must be configured as HTTPS URLs without credentials");
  }
  return url.origin;
}

/** Trust configured application/callback origins, never Host or forwarding headers. */
export function trustedBrowserOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_API_URL", "AUTH_URL", "NEXTAUTH_URL"]) {
    if (process.env[key]) origins.add(configuredOrigin(process.env[key]!));
  }
  for (const entry of (process.env.APP_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const url = new URL(entry);
    if (url.pathname !== "/" || url.search) throw new Error("APP_TRUSTED_ORIGINS must contain exact origins");
    origins.add(configuredOrigin(entry));
  }
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    const url = new URL(`https://${process.env.VERCEL_URL}`);
    if (url.hostname.endsWith(".vercel.app") && !url.port && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password) origins.add(url.origin);
  }
  for (const platform of ["shopee", "lazada", "tiktok", "shopify"]) {
    const value = process.env[`${platform.toUpperCase()}_REDIRECT_URL`];
    if (value) {
      try {
        const url = new URL(value);
        if (url.pathname === `/api/${platform}/callback` && !url.search) origins.add(configuredOrigin(value));
      } catch { /* An unused provider's invalid callback must not disable login. */ }
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

export function trustedRequestOrigin(request: BrowserRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return null;
  try {
    const parsed = new URL(origin);
    if (origin !== parsed.origin || !trustedBrowserOrigins().has(origin)) return null;
    if (request.headers.get("sec-fetch-site") === "cross-site") return null;
    return origin;
  } catch { return null; }
}

/** Resolve a local connection handoff to its configured callback host. */
export function marketplaceConnectOrigin(path: string | null | undefined): string | null {
  const safe = safeMarketplaceConnectPath(path);
  if (!safe) return null;
  try {
    const platform = new URL(safe, "https://local.invalid").pathname.split("/")[3]!;
    const raw = process.env[`${platform.toUpperCase()}_REDIRECT_URL`];
    if (!raw) return null;
    const url = new URL(raw);
    if (url.pathname !== `/api/${platform}/callback` || url.search || url.hash || url.username || url.password || !trustedBrowserOrigins().has(url.origin)) return null;
    return url.origin;
  } catch { return null; }
}

/** Strict Origin validation is the CSRF defense, including missing/null origins. */
export function guardBrowserWrite(request: BrowserRequest, json = false): NextResponse | null {
  if (!trustedRequestOrigin(request)) {
    return NextResponse.json({ error: "Untrusted browser request", code: "CSRF_ORIGIN_REJECTED" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (json && request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}
