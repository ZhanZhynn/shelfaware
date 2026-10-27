import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  actor: vi.fn(), create: vi.fn(), find: vi.fn(), claim: vi.fn(), cleanup: vi.fn(),
  exchange: vi.fn(), info: vi.fn(), authorized: vi.fn(), persist: vi.fn(), hmac: vi.fn(), fresh: vi.fn(),
  shopCreate: vi.fn(), shopFind: vi.fn(), shopUpdate: vi.fn(),
}));
vi.mock("@/utils/auth", () => ({ getSessionFromRequest: m.actor }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: vi.fn(async () => null), defaultRateLimits: { strict: {} } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/cache/cache-utils", () => ({ invalidateMarketplaceAnalytics: vi.fn(async () => {}) }));
vi.mock("@/lib/shopee", () => ({ isShopeeConfigured: () => true, getShopeeAuthUrl: (state: string) => `https://provider.example.test/shopee?state=${state}`, exchangeCodeForToken: m.exchange, getShopeeShopInfo: m.info }));
vi.mock("@/lib/lazada", () => ({ isLazadaConfigured: () => true, getLazadaAuthUrl: (_uri: string, state: string) => `https://provider.example.test/lazada?state=${state}` }));
vi.mock("@/lib/lazada/server", () => ({ exchangeLazadaCodeForToken: m.exchange, createLazadaShopContext: (value: unknown) => value, persistTokens: m.persist }));
vi.mock("@/lib/tiktok", () => ({ isTikTokConfigured: () => true, getTikTokAuthUrl: (_uri: string, state: string) => `https://provider.example.test/tiktok?state=${state}`, exchangeCodeForToken: m.exchange, getAuthorizedShops: m.authorized }));
vi.mock("@/lib/shopify", () => ({ isShopifyConfigured: () => true, getShopifyAuthUrl: (_shop: string, state: string) => `https://provider.example.test/shopify?state=${state}`, validateShopifyHmac: m.hmac, isTimestampFresh: m.fresh, exchangeCodeForToken: m.exchange, fetchShopInfo: m.info, persistShopConnection: m.persist }));
vi.mock("@/prisma/client", () => {
  const shop = { findFirst: m.shopFind, create: m.shopCreate, update: m.shopUpdate };
  const prisma = { marketplaceOAuthAttempt: { create: m.create, findUnique: m.find, updateMany: m.claim, deleteMany: m.cleanup }, shopeeShop: shop, lazadaShop: shop, tikTokShop: shop };
  return { prisma, default: prisma };
});

import * as shopeeAuth from "@/app/api/shopee/auth/route";
import * as lazadaAuth from "@/app/api/lazada/auth/route";
import * as tiktokAuth from "@/app/api/tiktok/auth/route";
import * as shopifyAuth from "@/app/api/shopify/auth/route";
import { GET as shopeeCallback } from "@/app/api/shopee/callback/route";
import { GET as lazadaCallback } from "@/app/api/lazada/callback/route";
import { GET as tiktokCallback } from "@/app/api/tiktok/callback/route";
import { GET as shopifyCallback } from "@/app/api/shopify/callback/route";
import { consumeMarketplaceOAuth } from "./marketplace-oauth";
import type { OAuthPlatform } from "./marketplace-connect";

const operator = { id: "a".repeat(24), role: "admin", status: "approved" };
let records: Map<string, any>;
const flows = [
  { platform: "shopee" as const, auth: shopeeAuth, callback: shopeeCallback },
  { platform: "lazada" as const, auth: lazadaAuth, callback: lazadaCallback },
  { platform: "tiktok" as const, auth: tiktokAuth, callback: tiktokCallback },
  { platform: "shopify" as const, auth: shopifyAuth, callback: shopifyCallback },
];

beforeEach(() => {
  vi.clearAllMocks(); records = new Map();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); vi.stubEnv("NEXT_PUBLIC_API_URL", "https://app.example.test");
  for (const flow of flows) vi.stubEnv(`${flow.platform.toUpperCase()}_REDIRECT_URL`, `https://callback.example.test/api/${flow.platform}/callback`);
  m.actor.mockResolvedValue(operator);
  m.create.mockImplementation(async ({ data }) => { const record = { ...data, id: String(records.size + 1) }; records.set(data.stateHash, record); return record; });
  m.cleanup.mockResolvedValue({ count: 0 });
  m.find.mockImplementation(async ({ where }) => { const record = records.get(where.stateHash); return record ? { ...record } : null; });
  m.claim.mockImplementation(async ({ where, data }) => {
    const record = records.get(where.stateHash);
    if (!record || record.consumedAt || record.expiresAt <= where.expiresAt.gt) return { count: 0 };
    Object.assign(record, data); return { count: 1 };
  });
  m.exchange.mockResolvedValue({ access_token: "fixture-access", refresh_token: "fixture-refresh", country: "my", country_user_info: [{ seller_id: "seller" }] });
  m.info.mockResolvedValue({ name: "Fixture shop", shop_name: "Fixture shop" }); m.authorized.mockResolvedValue([{ id: "provider-shop", cipher: "cipher", name: "Fixture shop" }]);
  m.shopFind.mockResolvedValue(null); m.shopCreate.mockImplementation(async ({ data }) => ({ id: "shop", ...data })); m.persist.mockResolvedValue(undefined);
  m.hmac.mockReturnValue(true); m.fresh.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

async function initiate(flow: typeof flows[number]) {
  const response = await flow.auth.POST(new NextRequest(`https://callback.example.test/api/${flow.platform}/auth`, {
    method: "POST", headers: { origin: "https://callback.example.test", "content-type": "application/json" }, body: JSON.stringify(flow.platform === "shopify" ? { shop: "store.myshopify.com" } : {}),
  }));
  expect(response.status).toBe(200);
  const state = new URL((await response.json()).url).searchParams.get("state")!;
  const cookie = response.cookies.getAll()[0]!;
  const params = new URLSearchParams({ state, code: "fixture-code", shop_id: "123", shop: "store.myshopify.com", hmac: "signature", timestamp: String(Math.floor(Date.now() / 1000)) });
  const callback = () => new NextRequest(`https://callback.example.test/api/${flow.platform}/callback?${params}`, { headers: { cookie: `${cookie.name}=${cookie.value}` } });
  return { response, state, cookie, params, callback };
}

describe.each(flows)("$platform authorization boundary", (flow) => {
  it("returns a canonical confirmation page on GET without issuing state", async () => {
    const response = await flow.auth.GET(new NextRequest(`https://app.example.test/api/${flow.platform}/auth`));
    expect(new URL((await response.json()).url).origin).toBe("https://callback.example.test");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("persists only hashes and exchanges a code only after single-use browser validation", async () => {
    const attempt = await initiate(flow);
    expect(attempt.cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(attempt.cookie.domain).toBeUndefined();
    const record = [...records.values()][0]; expect(record.stateHash).not.toBe(attempt.state); expect(record.browserHash).not.toBe(attempt.cookie.value);
    expect(record).not.toHaveProperty("accessToken");
    expect((await flow.callback(attempt.callback())).status).toBe(307);
    expect(m.exchange).toHaveBeenCalledOnce();
    expect((await flow.callback(attempt.callback())).status).toBe(400);
    expect(m.exchange).toHaveBeenCalledOnce();
  });
  it("rejects another browser and expired state before contacting the provider", async () => {
    const attempt = await initiate(flow);
    const noCookie = new NextRequest(attempt.callback().url);
    expect((await flow.callback(noCookie)).status).toBe(400);
    [...records.values()][0].expiresAt = new Date(0);
    expect((await flow.callback(attempt.callback())).status).toBe(400);
    expect(m.exchange).not.toHaveBeenCalled(); expect(m.persist).not.toHaveBeenCalled(); expect(m.shopCreate).not.toHaveBeenCalled();
  });
  it("rejects a different browser challenge even with a valid state and session", async () => {
    const attempt = await initiate(flow);
    const foreign = new NextRequest(attempt.callback().url, { headers: { cookie: `${attempt.cookie.name}=${"a".repeat(43)}` } });
    expect((await flow.callback(foreign)).status).toBe(400);
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it("requires POST plus a trusted Origin to initiate provider authorization", async () => {
    const response = await flow.auth.POST(new NextRequest(`https://callback.example.test/api/${flow.platform}/auth`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403); expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects wrong users, revoked approval, and non-operators before token persistence", async () => {
    const attempt = await initiate(flow);
    for (const actor of [{ ...operator, id: "b".repeat(24) }, { ...operator, status: "rejected" }, { ...operator, role: "client" }]) {
      m.actor.mockResolvedValue(actor); expect((await flow.callback(attempt.callback())).status).toBeGreaterThanOrEqual(400);
    }
    expect(m.exchange).not.toHaveBeenCalled(); expect(m.shopCreate).not.toHaveBeenCalled();
  });
  it("rejects unsolicited state and duplicate parameters before exchange", async () => {
    const attempt = await initiate(flow);
    attempt.params.append("code", "second-code");
    expect((await flow.callback(attempt.callback())).status).toBe(400);
    attempt.params.delete("state");
    expect((await flow.callback(attempt.callback())).status).toBe(400); expect(m.exchange).not.toHaveBeenCalled();
  });
  it("does not allow a cross-host POST to bypass canonical browser binding", async () => {
    const response = await flow.auth.POST(new NextRequest(`https://app.example.test/api/${flow.platform}/auth`, { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: JSON.stringify({ shop: "store.myshopify.com" }) }));
    expect(response.status).toBe(403); expect(m.create).not.toHaveBeenCalled();
  });
  it("allows only one provider exchange for simultaneous callbacks", async () => {
    const attempt = await initiate(flow);
    const responses = await Promise.all([flow.callback(attempt.callback()), flow.callback(attempt.callback())]);
    expect(responses.filter((response) => response.status === 307)).toHaveLength(1); expect(m.exchange).toHaveBeenCalledOnce();
  });
});

it("binds attempts to the provider and Shopify domain", async () => {
  const attempt = await initiate(flows[3]!);
  await expect(consumeMarketplaceOAuth(attempt.callback(), operator, "tiktok", attempt.state)).rejects.toThrow();
  attempt.params.set("shop", "other.myshopify.com");
  expect((await shopifyCallback(attempt.callback())).status).toBe(400); expect(m.exchange).not.toHaveBeenCalled();
});
it("retains Shopify HMAC rejection before claiming an attempt", async () => {
  const attempt = await initiate(flows[3]!); m.hmac.mockReturnValue(false);
  await shopifyCallback(attempt.callback()); expect(m.claim).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled();
});
it("consumes through a fresh module instance instead of process-local state", async () => {
  const attempt = await initiate(flows[0]!);
  vi.resetModules();
  const fresh = await import("./marketplace-oauth");
  await expect(fresh.consumeMarketplaceOAuth(attempt.callback(), operator, "shopee" as OAuthPlatform, attempt.state)).resolves.toMatchObject({ userId: operator.id });
});
