import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    shopeeShop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/prisma/client", () => ({ default: prismaMock }));

import { PrismaTokenStorage } from "./token-storage";

const token = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expire_in: 14_400,
  request_id: "",
  error: "",
  message: "",
  shop_id: 101,
  expired_at: 1_800_000_000_000,
};

describe("PrismaTokenStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses its bound shop ID for reads, writes, and clears", async () => {
    const storage = new PrismaTokenStorage(101);
    prismaMock.shopeeShop.findFirst
      .mockResolvedValueOnce({
        shopId: 101,
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
        tokenExpiry: new Date(1_800_000_000_000),
      })
      .mockResolvedValueOnce({ id: "shop-record" })
      .mockResolvedValueOnce({ id: "shop-record" });

    await expect(storage.get()).resolves.toMatchObject({
      access_token: "stored-access",
      shop_id: 101,
    });
    await storage.store(token);
    await storage.clear();

    expect(prismaMock.shopeeShop.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { shopId: 101 },
    }));
    expect(prismaMock.shopeeShop.findFirst).toHaveBeenNthCalledWith(2, {
      where: { shopId: 101 },
      select: { id: true },
    });
    expect(prismaMock.shopeeShop.findFirst).toHaveBeenNthCalledWith(3, {
      where: { shopId: 101 },
      select: { id: true },
    });
    expect(prismaMock.shopeeShop.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "shop-record" },
      data: expect.objectContaining({ accessToken: "access-token" }),
    }));
    expect(prismaMock.shopeeShop.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "shop-record" },
      data: expect.objectContaining({ accessToken: "", refreshToken: "" }),
    }));
  });

  it("does not persist a token returned for another shop", async () => {
    const storage = new PrismaTokenStorage(101);

    await storage.store({ ...token, shop_id: 202 });

    expect(prismaMock.shopeeShop.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.shopeeShop.update).not.toHaveBeenCalled();
  });
});
