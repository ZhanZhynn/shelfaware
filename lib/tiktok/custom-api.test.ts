import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrderStatementTransactions, getStatementTransactions, searchOrders } from "./custom-api";
import { TikTokProviderError } from "./provider-error";
import { logger } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

const originalAppKey = process.env.TIKTOK_APP_KEY;
const originalAppSecret = process.env.TIKTOK_APP_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TIKTOK_APP_KEY = "app-key";
  process.env.TIKTOK_APP_SECRET = "app-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAppKey === undefined) delete process.env.TIKTOK_APP_KEY;
  else process.env.TIKTOK_APP_KEY = originalAppKey;
  if (originalAppSecret === undefined) delete process.env.TIKTOK_APP_SECRET;
  else process.env.TIKTOK_APP_SECRET = originalAppSecret;
});

describe("getStatementTransactions", () => {
  it("requests the canonical signed paginated statement endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "Success",
      request_id: "request-id",
      data: { id: "statement-1", status: "SETTLED", next_page_token: "next-page" },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStatementTransactions("seller-token", "shop-cipher", "statement-1", 100, "page-token"))
      .resolves.toEqual({ id: "statement-1", status: "SETTLED", next_page_token: "next-page" });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe("/finance/202501/statements/statement-1/statement_transactions");
    expect(parsedUrl.searchParams.get("shop_cipher")).toBe("shop-cipher");
    expect(parsedUrl.searchParams.get("page_token")).toBe("page-token");
    expect(parsedUrl.searchParams.get("sort_field")).toBe("order_create_time");
    expect(parsedUrl.searchParams.get("sort_order")).toBe("DESC");
    expect(parsedUrl.searchParams.get("page_size")).toBe("100");
    expect(parsedUrl.searchParams.get("app_key")).toBe("app-key");
    expect(parsedUrl.searchParams.get("sign")).toBeTruthy();
    expect(request).toMatchObject({
      method: "GET",
      headers: { "x-tts-access-token": "seller-token" },
    });
  });
});

describe("getOrderStatementTransactions", () => {
  it("requests the canonical signed per-order finance endpoint", async () => {
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

describe("TikTok order requests and provider failures", () => {
  it("sends bounded order filters and the documented sorting parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, message: "Success", request_id: "request-id",
      data: { orders: [{ id: "order-1" }], total_count: 2, next_page_token: "next-page" },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const body = { create_time_ge: 1785513600, create_time_lt: 1788192000 };

    await expect(searchOrders("seller-token", "shop-cipher", body, 1, "page-token", "create_time", "DESC"))
      .resolves.toMatchObject({ orders: [{ id: "order-1" }], next_page_token: "next-page" });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe("/order/202309/orders/search");
    expect(Object.fromEntries(parsedUrl.searchParams)).toMatchObject({
      app_key: "app-key", shop_cipher: "shop-cipher", page_size: "1",
      page_token: "page-token", sort_field: "create_time", sort_order: "DESC",
      sign: expect.any(String),
    });
    expect(request).toMatchObject({ method: "POST", headers: { "x-tts-access-token": "seller-token" }, body: JSON.stringify(body) });
  });

  it.each([400, 200])("preserves a rejected sort field's diagnostics on HTTP %s without retaining the raw response", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 36009004,
      message: "SortField is invalid, allowed values: create_time,update_time.",
      request_id: "20261021182338E16E01C4331FDA00AD16",
      data: { access_token: "seller-token", private_field: "private-response-value" },
    }), { status })));

    const error = await searchOrders("seller-token", "shop-cipher").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TikTokProviderError);
    expect(error).toMatchObject({ code: "36009004", status, kind: "invalid_query", providerRequestId: "20261021182338E16E01C4331FDA00AD16" });
    expect(logger.error).toHaveBeenCalledWith(error, { code: "36009004", status, providerRequestId: "20261021182338E16E01C4331FDA00AD16" });
    expect(JSON.stringify({ error, logs: vi.mocked(logger.error).mock.calls })).not.toMatch(/seller-token|private-response-value|SortField is invalid/);
  });

  it.each([
    { message: "Access token is invalid: seller-token", kind: "auth" },
    { message: "Rate limit exceeded for seller-token", kind: "rate_limit" },
  ])("recognizes $kind errors on HTTP 200 without retaining provider messages", async ({ message, kind }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 12345, message, request_id: "provider-id", data: null,
    }))));

    const error = await searchOrders("seller-token", "shop-cipher").catch((value: unknown) => value);

    expect(error).toMatchObject({ status: 200, code: "12345", kind, providerRequestId: "provider-id" });
    expect(JSON.stringify({ error, logs: vi.mocked(logger.error).mock.calls })).not.toContain("seller-token");
    if (kind === "rate_limit") expect((error as Error).message).toMatch(/rate_limit|too_many_requests|429|throttle/i);
  });

  it.each([
    { status: 429, expectedStatus: 429, kind: "rate_limit" },
    { status: 502, expectedStatus: 502, kind: "temporary" },
    { status: 200, expectedStatus: 502, kind: "temporary" },
  ])("handles non-JSON HTTP $status responses without leaking the response body", async ({ status, expectedStatus, kind }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>private-response-value</html>", { status })));

    const error = await searchOrders("seller-token", "shop-cipher").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TikTokProviderError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: expectedStatus, kind, providerRequestId: null });
    expect(JSON.stringify({ error, logs: vi.mocked(logger.error).mock.calls })).not.toContain("private-response-value");
  });

  it("rejects unsafe provider identifiers instead of exposing them in errors or logs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "invalid code with seller-token", request_id: "provider-id\nseller-token",
      message: "private-response-value", data: null,
    }), { status: 400 })));

    const error = await searchOrders("seller-token", "shop-cipher").catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "UNKNOWN", providerRequestId: null });
    expect(JSON.stringify({ error, logs: vi.mocked(logger.error).mock.calls })).not.toMatch(/seller-token|private-response-value/);
  });
});
