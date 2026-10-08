import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({
  prisma: { apiToken: mocks },
}));

import {
  ApiTokenAuthenticationError,
  createApiToken,
  parseBearerToken,
  publicApiToken,
  resolveApiToken,
} from "./api-token";

const token = `swa_${"a".repeat(43)}`;
const record = {
  id: "token-1",
  userId: "user-1",
  name: "Agent",
  tokenPrefix: "swa_aaaaaaaaaaaa",
  tokenHash: "hash",
  scopes: ["marketplace:read"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  user: { id: "user-1", status: "approved" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockResolvedValue({});
});

describe("API token authentication", () => {
  it("parses only the supported bearer token format", () => {
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token);
    expect(parseBearerToken(null)).toBeNull();
    expect(() => parseBearerToken("Bearer invalid")).toThrow(ApiTokenAuthenticationError);
  });

  it("resolves an approved, unrevoked token and updates last-used best effort", async () => {
    mocks.findUnique.mockResolvedValue(record);

    const resolved = await resolveApiToken(token);

    expect(resolved.user).toEqual(record.user);
    expect(resolved.token).toEqual({ id: "token-1", scopes: ["marketplace:read"] });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "token-1" } }));
  });

  it.each([
    [null],
    [{ ...record, revokedAt: new Date() }],
    [{ ...record, expiresAt: new Date("2020-01-01") }],
    [{ ...record, user: { ...record.user, status: "pending" } }],
  ])("rejects unknown, inactive, and unapproved tokens", async (value) => {
    mocks.findUnique.mockResolvedValue(value);
    await expect(resolveApiToken(token)).rejects.toBeInstanceOf(ApiTokenAuthenticationError);
  });

  it("stores a hash and returns a plaintext token only from creation", async () => {
    mocks.create.mockImplementation(async ({ data }) => ({
      id: "token-1",
      userId: data.userId,
      name: data.name,
      tokenPrefix: data.tokenPrefix,
      scopes: data.scopes,
      createdAt: new Date("2026-01-01"),
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    }));

    const created = await createApiToken({ userId: "user-1", name: "Agent", scopes: ["marketplace:read"] });

    expect(created.token).toMatch(/^swa_[A-Za-z0-9_-]{43}$/);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tokenHash: expect.any(String) }),
    }));
    expect(publicApiToken(created.record)).not.toHaveProperty("tokenHash");
  });
});
