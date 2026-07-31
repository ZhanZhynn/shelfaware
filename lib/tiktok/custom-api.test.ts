import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrderStatementTransactions } from "./custom-api";

const originalAppKey = process.env.TIKTOK_APP_KEY;
const originalAppSecret = process.env.TIKTOK_APP_SECRET;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAppKey === undefined) delete process.env.TIKTOK_APP_KEY;
  else process.env.TIKTOK_APP_KEY = originalAppKey;
  if (originalAppSecret === undefined) delete process.env.TIKTOK_APP_SECRET;
  else process.env.TIKTOK_APP_SECRET = originalAppSecret;
});

describe("getOrderStatementTransactions", () => {
  it("requests the canonical signed per-order finance endpoint", async () => {
    process.env.TIKTOK_APP_KEY = "app-key";
    process.env.TIKTOK_APP_SECRET = "app-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "Success",
      request_id: "request-id",
      data: { order_id: "order-1", currency: "MYR", sku_transactions: [] },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrderStatementTransactions("seller-token", "shop-cipher", "order-1"))
      .resolves.toEqual({ order_id: "order-1", currency: "MYR", sku_transactions: [] });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe("/finance/202501/orders/order-1/statement_transactions");
    expect(parsedUrl.searchParams.get("shop_cipher")).toBe("shop-cipher");
    expect(parsedUrl.searchParams.get("app_key")).toBe("app-key");
    expect(parsedUrl.searchParams.get("sign")).toBeTruthy();
    expect(request).toMatchObject({
      method: "GET",
      headers: { "x-tts-access-token": "seller-token" },
    });
  });
});
