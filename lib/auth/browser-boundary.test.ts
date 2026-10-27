import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), token: vi.fn(), update: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { user: { findUnique: m.user }, apiToken: { findUnique: m.token, update: m.update, create: m.create, updateMany: m.revoke } } }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: vi.fn(async () => null), defaultRateLimits: { strict: {} } }));
import { generateToken, getSessionFromRequest } from "@/utils/auth";
import { requireApiActor, ApiScopeError } from "./require-api-scope";
import { POST as createToken } from "@/app/api/api-tokens/route";
import { DELETE as revokeToken } from "@/app/api/api-tokens/[id]/route";

const user = { id: "a".repeat(24), role: "admin", status: "approved" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); vi.stubEnv("NEXT_PUBLIC_API_URL", "https://app.example.test");
  m.user.mockResolvedValue(user); m.update.mockResolvedValue({});
  m.token.mockResolvedValue({ id: "token", revokedAt: null, expiresAt: null, scopes: ["marketplace:read"], user });
});
afterEach(() => vi.unstubAllEnvs());
const sessionRequest = (method: string, origin?: string, extra = {}) => new NextRequest("https://app.example.test/api/resource", { method, headers: { cookie: `session_id=${generateToken(user.id)}`, ...(origin ? { origin } : {}), ...extra } });

it("rejects untrusted session writes even if a fake Authorization header is supplied", async () => {
  for (const origin of [undefined, "null", "https://attacker.example"]) {
    await expect(getSessionFromRequest(sessionRequest("POST", origin, { authorization: "Bearer fake" }))).resolves.toBeNull();
  }
  expect(m.user).not.toHaveBeenCalled();
});
it("supports trusted session writes and headerless server/read requests", async () => {
  await expect(getSessionFromRequest(sessionRequest("POST", "https://app.example.test"))).resolves.toEqual(user);
  await expect(getSessionFromRequest(sessionRequest("GET"))).resolves.toEqual(user);
});
it("denies cross-origin API-token creation and revocation before token database changes", async () => {
  const create = new NextRequest("https://app.example.test/api/api-tokens", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" });
  expect((await createToken(create)).status).toBe(403);
  expect((await revokeToken(sessionRequest("DELETE", "https://attacker.example"), { params: Promise.resolve({ id: "token" }) })).status).toBe(403);
  expect(m.create).not.toHaveBeenCalled(); expect(m.revoke).not.toHaveBeenCalled(); expect(m.user).not.toHaveBeenCalled();
});
it("keeps verified scoped bearer clients independent of browser Origin headers", async () => {
  const request = new NextRequest("https://app.example.test/api/v1/marketplaces/shopee/syncs", { method: "POST", headers: { authorization: `Bearer swa_${"a".repeat(43)}` } });
  await expect(requireApiActor(request, ["marketplace:read"])).resolves.toMatchObject({ authType: "api_token", user });
  await expect(requireApiActor(request, ["marketplace:sync"])).rejects.toBeInstanceOf(ApiScopeError);
  expect(m.user).not.toHaveBeenCalled();
});
