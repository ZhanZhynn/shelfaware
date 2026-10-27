import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { trustedBrowserOrigins, trustedRequestOrigin } from "@/lib/security/browser-request";
import type { OAuthPlatform } from "./marketplace-connect";

const TTL_SECONDS = 600;
const opaque = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Operator = { id: string; role?: string | null; status?: string | null };

export class MarketplaceOAuthError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

export function assertShopOperator(user: Operator | null | undefined): asserts user is Operator {
  if (!user) throw new MarketplaceOAuthError("Unauthorized", 401);
  if (user.role !== "admin" || (user.status ?? "approved") !== "approved") throw new MarketplaceOAuthError("An approved admin is required to connect shops", 403);
}

export function marketplaceCallbackUri(platform: OAuthPlatform): URL {
  const value = process.env[`${platform.toUpperCase()}_REDIRECT_URL`];
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (url.pathname !== `/api/${platform}/callback` || url.search || url.hash || url.username || url.password || !trustedBrowserOrigins().has(url.origin)) throw new Error();
    return url;
  } catch { throw new MarketplaceOAuthError("Configure the marketplace's exact trusted application callback URL", 503); }
}

export function marketplaceConnectUrl(platform: OAuthPlatform, shopDomain?: string): URL {
  const url = new URL(`/marketplace/connect/${platform}`, marketplaceCallbackUri(platform));
  if (shopDomain) url.searchParams.set("shop", shopDomain);
  return url;
}

function cookieName(platform: OAuthPlatform, stateHash: string, secure: boolean) {
  return `${secure ? "__Host-" : ""}swa_oauth_${platform}_${stateHash.slice(0, 16)}`;
}

export async function beginMarketplaceOAuth(request: NextRequest, user: Operator, platform: OAuthPlatform, shopDomain?: string) {
  assertShopOperator(user);
  const callback = marketplaceCallbackUri(platform);
  if (trustedRequestOrigin(request) !== callback.origin) throw new MarketplaceOAuthError("Start authorization on the configured callback host", 403);
  const now = new Date();
  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  // Indexed cleanup bounds retained records without relying on deletion for expiry.
  await prisma.marketplaceOAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.marketplaceOAuthAttempt.create({ data: {
    stateHash: hash(state), browserHash: hash(browser), userId: user.id, provider: platform,
    callbackUri: callback.href, shopDomain: shopDomain ?? null,
    createdAt: now, expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000), consumedAt: null,
  } });
  return {
    state,
    setCookie(response: NextResponse) {
      response.cookies.set(cookieName(platform, hash(state), callback.protocol === "https:"), browser, {
        httpOnly: true, secure: callback.protocol === "https:", sameSite: "lax", path: "/", maxAge: TTL_SECONDS,
      });
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    },
  };
}

export async function consumeMarketplaceOAuth(request: NextRequest, user: Operator | null, platform: OAuthPlatform, state: string, shopDomain?: string) {
  assertShopOperator(user);
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length || !opaque.test(state)) throw new MarketplaceOAuthError("Invalid authorization attempt");
  const callback = marketplaceCallbackUri(platform);
  const stateHash = hash(state);
  const name = cookieName(platform, stateHash, callback.protocol === "https:");
  const browser = request.cookies.get(name)?.value;
  if (!browser || !opaque.test(browser)) throw new MarketplaceOAuthError("Invalid authorization attempt");
  const attempt = await prisma.marketplaceOAuthAttempt.findUnique({ where: { stateHash } });
  const now = new Date();
  if (!attempt || attempt.provider !== platform || attempt.userId !== user.id || attempt.callbackUri !== callback.href || attempt.shopDomain !== (shopDomain ?? null) || attempt.consumedAt || attempt.expiresAt <= now || attempt.browserHash.length !== 64 || !timingSafeEqual(Buffer.from(attempt.browserHash), Buffer.from(hash(browser)))) {
    throw new MarketplaceOAuthError("Invalid or expired authorization attempt");
  }
  const claimed = await prisma.marketplaceOAuthAttempt.updateMany({
    where: { id: attempt.id, stateHash, browserHash: hash(browser), userId: user.id, provider: platform, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) throw new MarketplaceOAuthError("Authorization attempt has already been used");
  return {
    userId: user.id,
    finish(response: NextResponse) {
      response.cookies.set(name, "", { httpOnly: true, secure: callback.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    },
  };
}
