import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/prisma/client", () => ({
  default: { lazadaShop: { updateMany } },
  prisma: { lazadaShop: { updateMany } },
}));

import { persistTokens } from "./server";
import type { LazadaShopContext } from "./server";
import type { LazadaResponseAccessToken } from "lazada-api-client";

const context: LazadaShopContext = {
  shopId: "internal-shop-a",
  userId: "user-a",
  sellerId: "seller-a",
  countryCode: "my",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  tokenExpiry: null,
  refreshExpiry: null,
};

describe("Lazada token persistence context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("updates only the exact internal shop and owning tenant", async () => {
    await persistTokens(context, {
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      refresh_expires_in: 7200,
    } as LazadaResponseAccessToken);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "internal-shop-a", userId: "user-a", sellerId: "seller-a" },
      data: expect.objectContaining({ accessToken: "new-access", refreshToken: "new-refresh" }),
    }));
  });

  it("fails rather than falling back when the scoped shop no longer exists", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(persistTokens(context, {
      access_token: "new-access",
      refresh_token: "new-refresh",
    } as LazadaResponseAccessToken)).rejects.toThrow("no longer available");
  });
});
