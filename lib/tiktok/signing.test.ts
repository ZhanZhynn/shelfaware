import { describe, expect, it } from "vitest";
import { generateSign } from "./signing";

describe("TikTok request signature invariants", () => {
  const path = "/order/202309/orders/search";
  const params = Object.freeze({ app_key: "fixture-key", timestamp: "1792584000", shop_cipher: "fixture-cipher" });
  it("is deterministic regardless of query-key insertion order and does not mutate inputs", () => {
    const before = { ...params };
    const signature = generateSign(path, params, null, "fixture-secret");
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(generateSign(path, { shop_cipher: params.shop_cipher, timestamp: params.timestamp, app_key: params.app_key }, null, "fixture-secret")).toBe(signature);
    expect(params).toEqual(before);
  });
  it("excludes token/sign fields without excluding genuine query parameters", () => {
    const signature = generateSign(path, params, null, "fixture-secret");
    expect(generateSign(path, { ...params, sign: "old", access_token: "token" }, null, "fixture-secret")).toBe(signature);
    expect(generateSign(path, { ...params, page_token: "next" }, null, "fixture-secret")).not.toBe(signature);
  });
  it.each(["path", "body", "secret"])("binds the request signature to %s", (changed) => {
    const signature = generateSign(path, params, '{"create_time_ge":100}', "fixture-secret");
    expect(generateSign(changed === "path" ? "/different" : path, params, changed === "body" ? '{"create_time_ge":101}' : '{"create_time_ge":100}', changed === "secret" ? "different-secret" : "fixture-secret")).not.toBe(signature);
  });
});
