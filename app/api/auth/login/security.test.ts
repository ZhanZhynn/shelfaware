import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ find: vi.fn(), compare: vi.fn(), sign: vi.fn(), limit: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { user: { findUnique: m.find } } }));
vi.mock("@/utils/auth", () => ({ generateToken: m.sign }));
vi.mock("bcryptjs", () => ({ default: { compare: m.compare } }));
vi.mock("@/lib/api/rate-limit", () => ({ withRateLimit: m.limit, defaultRateLimits: { auth: {}, authAccount: {} } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); vi.stubEnv("NEXT_PUBLIC_API_URL", "https://app.example.test");
  m.limit.mockResolvedValue(null); m.compare.mockResolvedValue(true); m.sign.mockReturnValue("synthetic-session");
  m.find.mockResolvedValue({ id: "operator", name: "Operator", email: "Operator@example.test", password: "hash", role: "admin", status: "approved" });
});
afterEach(() => vi.unstubAllEnvs());
const request = (origin?: string, type = "application/json") => new NextRequest("https://app.example.test/api/auth/login", {
  method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body: JSON.stringify({ email: "Operator@example.test", password: "fixture" }),
});
it.each([undefined, "null", "https://attacker.example"])("rejects login CSRF before password lookup: %s", async (origin) => {
  const response = await POST(request(origin)); expect(response.status).toBe(403); expect(response.cookies.get("session_id")).toBeUndefined();
  expect(m.find).not.toHaveBeenCalled(); expect(m.compare).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
});
it("rejects the form-compatible text/plain login bypass", async () => {
  expect((await POST(request("https://app.example.test", "text/plain"))).status).toBe(415);
  expect(m.find).not.toHaveBeenCalled();
});
it("allows a legitimate JSON login and limits a normalized account identity", async () => {
  const response = await POST(request("https://app.example.test")); expect(response.status).toBe(200);
  expect(response.cookies.get("session_id")?.httpOnly).toBe(true);
  expect(m.limit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "login-account:operator@example.test");
});
it("returns 429 before password comparison when the account budget is exhausted", async () => {
  m.limit.mockResolvedValueOnce(null).mockResolvedValueOnce(new Response(null, { status: 429 }));
  expect((await POST(request("https://app.example.test"))).status).toBe(429); expect(m.find).not.toHaveBeenCalled();
});
