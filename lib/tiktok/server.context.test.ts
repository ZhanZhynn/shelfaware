import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getAuthorizedShops } = vi.hoisted(() => ({
  prismaMock: {
    tikTokShop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  getAuthorizedShops: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("./custom-api", () => ({ getAuthorizedShops }));
vi.mock("@/lib/env", () => ({
  getEnvVar: (key: string) => ({
    JWT_SECRET: "test-jwt-secret",
    TIKTOK_APP_KEY: "test-app-key",
    TIKTOK_APP_SECRET: "test-app-secret",
  })[key],
}));

import {
  ensureFreshToken,
  getTikTokShopCipher,
  validateTikTokToken,
} from "./server";

const shopContext = { shopId: "shop-1", userId: "user-1" };

describe("TikTok explicit shop context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tikTokShop.findFirst.mockResolvedValue({
      id: "shop-record-1",
      accessToken: "access-token-1",
      shopCipher: "cipher-1",
      tokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    getAuthorizedShops.mockResolvedValue([]);
  });

  it("resolves token validation with the supplied shop and user", async () => {
    await expect(validateTikTokToken(shopContext)).resolves.toEqual({ valid: true });

    expect(prismaMock.tikTokShop.findFirst).toHaveBeenCalledWith({
      where: shopContext,
    });
    expect(getAuthorizedShops).toHaveBeenCalledWith("access-token-1");
  });

  it("resolves refresh and cipher lookup with the supplied shop and user", async () => {
    await expect(ensureFreshToken(shopContext)).resolves.toBe("access-token-1");
    await expect(getTikTokShopCipher(shopContext)).resolves.toBe("cipher-1");

    expect(prismaMock.tikTokShop.findFirst).toHaveBeenNthCalledWith(1, {
      where: shopContext,
    });
    expect(prismaMock.tikTokShop.findFirst).toHaveBeenNthCalledWith(2, {
      where: shopContext,
    });
  });
});
