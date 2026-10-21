import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ getEnvVar: env }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
import { getAuthorizedShops, getOrderDetail, getProductDetail, searchOrders, searchProducts } from "./custom-api";

const request = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  env.mockReturnValue("fixture");
  vi.stubGlobal("fetch", request);
});
afterEach(() => vi.unstubAllGlobals());

describe("TikTok product and detail client contracts", () => {
  it("requests authorized shops with the explicit token and no shop cipher", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { shops: [{ id: "shop", cipher: "cipher" }] } })));
    expect(await getAuthorizedShops("token")).toEqual([{ id: "shop", cipher: "cipher" }]);
    const [url, options] = request.mock.calls[0]!;
    expect(new URL(url).pathname).toBe("/authorization/202309/shops");
    expect(options.headers["x-tts-access-token"]).toBe("token");
    expect(new URL(url).searchParams.has("shop_cipher")).toBe(false);
  });

  it("sends product search filters as a signed POST body and preserves pagination", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { products: [{ product_id: "p" }], next_page_token: "next" } })));
    const body = { status: "ACTIVATE", seller_skus: ["BOX-RED"], update_time_ge: 100 };
    expect(await searchProducts("token", "cipher", body, 20, "page")).toMatchObject({ next_page_token: "next" });
    const [url, options] = request.mock.calls[0]!;
    expect(new URL(url).pathname).toBe("/product/202502/products/search");
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ page_size: "20", shop_cipher: "cipher", page_token: "page" });
    expect(options).toMatchObject({ method: "POST", body: JSON.stringify(body) });
  });

  it("retains complete product detail facts without substituting search summaries", async () => {
    const data = { id: "p", skus: [{ id: "sku", price: { sale_price: "0.00", currency: "MYR" }, inventory: [{ quantity: 0 }] }] };
    request.mockResolvedValue(new Response(JSON.stringify({ code: 0, data })));
    expect(await getProductDetail("token", "cipher", "p")).toEqual(data);
    const [url, options] = request.mock.calls[0]!;
    expect(new URL(url).pathname).toBe("/product/202309/products/p");
    expect(new URL(url).searchParams.get("shop_cipher")).toBe("cipher");
    expect(options.method).toBe("GET");
  });

  it("enforces order-detail batch bounds without making an HTTP request", async () => {
    expect(await getOrderDetail("token", "cipher", [])).toEqual({ orders: [] });
    await expect(getOrderDetail("token", "cipher", Array.from({ length: 51 }, (_, i) => String(i)))).rejects.toThrow("max 50");
    expect(request).not.toHaveBeenCalled();
  });

  it("retrieves detail IDs in one bounded request and passes update-time search filters", async () => {
    request.mockImplementation(async (url: string) => new Response(JSON.stringify({ code: 0, data: new URL(url).pathname.endsWith("search") ? { orders: [], next_page_token: "" } : { orders: [{ id: "o1", line_items: [] }] } })));
    expect(await getOrderDetail("token", "cipher", ["o1", "o2"])).toMatchObject({ orders: [{ id: "o1" }] });
    expect(new URL(request.mock.calls[0]![0]).searchParams.get("ids")).toBe("o1,o2");
    await searchOrders("token", "cipher", { update_time_ge: 100, update_time_lt: 200 }, 50, undefined, "update_time", "ASC");
    const [url, options] = request.mock.calls[1]!;
    expect(new URL(url).searchParams.get("sort_field")).toBe("update_time");
    expect(JSON.parse(options.body)).toEqual({ update_time_ge: 100, update_time_lt: 200 });
  });

  it("fails before network access when application signing configuration is absent", async () => {
    env.mockReturnValue(undefined);
    await expect(getAuthorizedShops("token")).rejects.toThrow("not configured");
    expect(request).not.toHaveBeenCalled();
  });
});
