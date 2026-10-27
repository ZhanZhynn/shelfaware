import { describe, expect, it } from "vitest";
import { REDACTED, redactError, redactTelemetry, redactText } from "./redaction";

describe("credential redaction", () => {
  it.each([
    "https://auth.example.test/token?app_secret=PRIVATE_A&refresh_token=PRIVATE_B&request_id=keep-me",
    "GET https://api.example.test/products?ACCESS%5FTOKEN=PRIVATE_A&code=PRIVATE_B",
    'request failed: {"accessToken":"PRIVATE_A","refresh_token":"PRIVATE_B"}',
    "Authorization: Bearer PRIVATE_A\nCookie: session_id=PRIVATE_B; another=PRIVATE_C",
    "Basic UFJJVkFURV9B\nBearer PRIVATE_B",
    "mongodb+srv://user:PRIVATE_A@db.example.test/catalog",
    encodeURIComponent("https://auth.example.test/token?app_secret=PRIVATE_A&refresh_token=PRIVATE_B"),
    encodeURIComponent(encodeURIComponent("https://auth.example.test/token?app_secret=PRIVATE_A")),
    "operation failed with swa_abcdefghijklmnopqrstuvwxyz0123456789_ABCD",
  ])("scrubs credential-bearing text: %s", (text) => {
    const safe = redactText(text);
    expect(safe).not.toMatch(/PRIVATE_[ABC]|UFJJVkFURV9B|swa_abcdefghijklmnopqrstuvwxyz/);
    expect(safe).toContain(REDACTED);
  });

  it("retains provider codes, request IDs and useful endpoints", () => {
    expect(redactTelemetry({ providerCode: "IllegalAccessToken", requestId: "req-123", status: 401, url: "https://api.example.test/orders?access_token=PRIVATE_A&request_id=req-123" })).toEqual({
      providerCode: "IllegalAccessToken", requestId: "req-123", status: 401,
      url: `https://api.example.test/orders?access_token=${REDACTED}&request_id=req-123`,
    });
  });

  it("scrubs nested mixed-case and flattened attribute keys without mutating input", () => {
    const source = {
      request: { headers: { Authorization: "PRIVATE_A", COOKIE: "PRIVATE_B", "X-Shopify-Access-Token": "PRIVATE_C", "x-request-id": "keep-me" } },
      contexts: { custom: { refreshToken: "PRIVATE_D", "http.request.header.x-api-key": "PRIVATE_E", providerCode: "THROTTLED" } },
    };
    const safe = redactTelemetry(source);
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
    expect(safe.request.headers["x-request-id"]).toBe("keep-me");
    expect(safe.contexts.custom.providerCode).toBe("THROTTLED");
    expect(source.request.headers.Authorization).toBe("PRIVATE_A");
  });

  it("omits raw SDK config, bodies and binary data", () => {
    const safe = redactTelemetry({ config: { data: "PRIVATE_A" }, body: "PRIVATE_B", rawPayload: { data: "PRIVATE_C" }, bytes: new Uint8Array([1, 2, 3]), request: { data: "PRIVATE_D", url: "/orders" }, response: { data: "PRIVATE_E", status: 500 }, "sentry.message.parameter.0": "PRIVATE_F" });
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
    expect(safe.bytes).toBe("[OMITTED]");
  });

  it("handles native Headers, query parameters, and tuple headers", () => {
    const safe = redactTelemetry({
      headers: new Headers({ Authorization: "PRIVATE_A", "x-request-id": "keep-me" }),
      params: new URLSearchParams({ refresh_token: "PRIVATE_B", code: "PRIVATE_C", state: "PRIVATE_D", request_id: "keep-me" }),
      tuples: [["Cookie", "PRIVATE_E"]],
    });
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
    expect(JSON.stringify(safe)).toContain("keep-me");
  });

  it("does not invoke getters or toJSON and tolerates cycles", () => {
    const source: Record<string, unknown> = { providerCode: "TEMPORARY" };
    source.self = source;
    Object.defineProperty(source, "computed", { enumerable: true, get() { throw new Error("Getter must not run"); } });
    source.toJSON = () => { throw new Error("toJSON must not run"); };
    const safe = redactTelemetry(source);
    expect(safe).toMatchObject({ self: "[CIRCULAR]", computed: "[OMITTED]" });
    expect(() => JSON.stringify(safe)).not.toThrow();
  });

  it("bounds deeply nested, wide and long input", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let i = 0; i < 100; i++) { const child = {}; cursor.child = child; cursor = child; }
    const safe = redactTelemetry({ deep: root, wide: Array.from({ length: 10_000 }, () => "value"), long: "x".repeat(100_000) });
    expect(JSON.stringify(safe).length).toBeLessThan(20_000);
    expect(JSON.stringify(safe)).toContain("[TRUNCATED]");
  });

  it("does not copy arbitrary class instances or prototype-pollution properties", () => {
    class RequestObject { payload = "PRIVATE_A"; }
    const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"token":"PRIVATE_B"}}');
    const safe = redactTelemetry({ request: new RequestObject(), value });
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
    expect(Object.hasOwn(safe.value, "__proto__")).toBe(false);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("is stable when a value passes through multiple redaction boundaries", () => {
    const safe = redactTelemetry({ token: "PRIVATE_A", message: "Failed https://auth.example.test/token?app_secret=PRIVATE_B" });
    expect(redactTelemetry(safe)).toEqual(safe);
  });

  it("creates a detached safe Error with stack and causes", () => {
    const source = new Error("Refresh failed: refresh_token=PRIVATE_A", { cause: new Error("app_secret=PRIVATE_B") });
    source.stack = "Error: refresh_token=PRIVATE_A\n at refresh (/app/provider.ts:12:3)";
    Object.assign(source, { config: { raw: "PRIVATE_C" }, providerCode: "EXPIRED" });
    const safe = redactError(source);
    expect(safe).toBeInstanceOf(Error);
    expect(safe).not.toBe(source);
    expect(JSON.stringify(redactTelemetry(safe))).not.toContain("PRIVATE_");
    expect(safe.stack).toContain("/app/provider.ts:12:3");
    expect(safe).toHaveProperty("providerCode", "EXPIRED");
    expect(source.message).toContain("PRIVATE_A");
  });
});
