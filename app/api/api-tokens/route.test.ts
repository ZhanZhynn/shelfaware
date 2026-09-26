import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  withRateLimit: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock("@/lib/api/rate-limit", () => ({
  withRateLimit: mocks.withRateLimit,
  defaultRateLimits: { strict: { limit: 30, window: 60, strictFallback: true } },
}));
vi.mock("@/prisma/client", () => ({ prisma: { apiToken: { findMany: mocks.findMany, create: mocks.create } } }));
vi.mock("@/prisma/audit-log", () => ({ createAuditLog: mocks.createAuditLog }));

import { GET, POST } from "./route";

const storedToken = {
  id: "token-1",
  userId: "user-1",
  name: "Agent",
  tokenPrefix: "swa_abcdefghijk",
  scopes: ["marketplace:read"],
  createdAt: new Date("2026-01-01"),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSessionFromRequest.mockResolvedValue({ id: "user-1" });
  mocks.withRateLimit.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([storedToken]);
  mocks.create.mockResolvedValue(storedToken);
  mocks.createAuditLog.mockResolvedValue({});
});

describe("API token routes", () => {
  it("requires a session to list tokens", async () => {
    mocks.getSessionFromRequest.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/api-tokens"));
    expect(response.status).toBe(401);
  });

  it("lists only public token metadata", async () => {
    const response = await GET(new NextRequest("http://localhost/api/api-tokens"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tokens).toEqual([expect.objectContaining({ id: "token-1", prefix: "swa_abcdefghijk" })]);
    expect(body.tokens[0]).not.toHaveProperty("tokenHash");
  });

  it("returns the generated secret once after a validated create", async () => {
    const response = await POST(new NextRequest("http://localhost/api/api-tokens", {
      method: "POST",
      body: JSON.stringify({ name: "Agent", scopes: ["marketplace:read"] }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toMatch(/^swa_[A-Za-z0-9_-]{43}$/);
    expect(body.apiToken).not.toHaveProperty("tokenHash");
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("does not create a token after a strict rate-limit response", async () => {
    mocks.withRateLimit.mockResolvedValue(NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }));
    const response = await POST(new NextRequest("http://localhost/api/api-tokens", {
      method: "POST",
      body: JSON.stringify({ name: "Agent", scopes: ["marketplace:read"] }),
    }));

    expect(response.status).toBe(429);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
