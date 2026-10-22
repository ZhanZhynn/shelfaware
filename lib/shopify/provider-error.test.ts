import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { shopifyGraphQL, validateShopifyToken } from "./server";
import { ShopifyProviderError } from "./provider-error";

afterEach(() => vi.unstubAllGlobals());
const call = () => shopifyGraphQL("fixture.myshopify.com", "synthetic-token", "query { shop { name } }");
const reply = (body: unknown, status = 200, requestId = "fixture-request") => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "x-request-id": requestId } })));
};

describe("Shopify safe provider failures", () => {
  it.each([
    [400, "HTTP_REJECTED", false], [401, "ACCESS_DENIED", false], [403, "ACCESS_DENIED", false],
    [404, "HTTP_REJECTED", false], [408, "TEMPORARY", true], [429, "THROTTLED", true],
    [500, "TEMPORARY", true], [503, "TEMPORARY", true],
  ])("classifies HTTP %s without retaining the response body", async (status, code, retryable) => {
    reply({ errors: "private-token private-customer" }, status as number);
    const error = await call().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ShopifyProviderError);
    expect(error).toMatchObject({ code, retryable, status, providerRequestId: "fixture-request" });
    expect(String(error) + JSON.stringify(error)).not.toMatch(/private-token|private-customer/);
  });

  it.each([
    ["undefinedField", "Field 'nodes' doesn't exist on type 'OrderTransaction'", "SCHEMA_INVALID", false],
    ["argumentNotAccepted", "private-token", "SCHEMA_INVALID", false],
    ["GRAPHQL_VALIDATION_FAILED", "private-token", "SCHEMA_INVALID", false],
    [undefined, "Unknown argument 'after' private-token", "SCHEMA_INVALID", false],
    ["ACCESS_DENIED", "private-token", "ACCESS_DENIED", false],
    [undefined, "Access denied for orders field private-token", "ACCESS_DENIED", false],
    ["THROTTLED", "private-token", "THROTTLED", true],
    [undefined, "Throttled private-token", "THROTTLED", true],
    ["INTERNAL_SERVER_ERROR", "private-token", "TEMPORARY", true],
    ["UNRECOGNIZED-private-token", "private-token", "GRAPHQL_REJECTED", false],
  ])("classifies GraphQL errors safely (%s)", async (providerCode, message, code, retryable) => {
    reply({ data: { shop: { name: "partial-must-not-escape" } }, errors: [{ message, extensions: { code: providerCode } }] });
    const error = await call().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code, retryable, providerRequestId: "fixture-request" });
    expect(String(error) + JSON.stringify(error)).not.toContain("private-token");
  });

  it("prioritizes permanent failures in a mixed envelope", async () => {
    reply({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }, { message: "bad selection", extensions: { code: "undefinedField" } }] });
    await expect(call()).rejects.toMatchObject({ code: "SCHEMA_INVALID", retryable: false });
  });

  it.each([null, [], {}, { data: null }, { data: "private-token" }, { errors: "private-token" }, { errors: [null] }, { errors: [{ message: 12 }] }, { errors: [{ message: "private-token", extensions: [] }] }])("rejects malformed GraphQL envelopes (%#)", async (body) => {
    reply(body);
    await expect(call()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: true });
  });

  it("discards invalid JSON and unsafe/unbounded correlation identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-token", { headers: { "x-request-id": "x".repeat(161) } })));
    await expect(call()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", providerRequestId: null });
    reply({}, 403, "private token");
    await expect(call()).rejects.toMatchObject({ code: "ACCESS_DENIED", providerRequestId: null });
  });

  it("normalizes transport failures without retaining their cause", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-token https://private-shop")));
    const error = await call().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "TEMPORARY", status: 0, retryable: true });
    expect(String(error) + JSON.stringify(error)).not.toContain("private");
    expect(error).not.toHaveProperty("cause");
  });

  it("preserves the typed failure through the token preflight result", async () => {
    reply({}, 401);
    await expect(validateShopifyToken({ shopDomain: "fixture.myshopify.com", accessToken: "synthetic-token" })).resolves.toMatchObject({
      valid: false, providerError: expect.objectContaining({ code: "ACCESS_DENIED", retryable: false }),
    });
  });
});
