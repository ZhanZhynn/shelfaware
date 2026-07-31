import { describe, expect, it } from "vitest";
import { sanitizeMarketplaceRawPayload } from "./json";

describe("sanitizeMarketplaceRawPayload", () => {
  it("retains diagnostics while removing customer data and credentials recursively", () => {
    const payload = sanitizeMarketplaceRawPayload({ order_id: "o1", amount: "12.50", customer: { email: "buyer@example.test", address: "private" }, nested: { access_token: "secret", status: "paid" }, items: [{ sku: "SKU-1", recipient_phone: "123" }] });
    expect(payload).toEqual({ order_id: "o1", amount: "12.50", nested: { status: "paid" }, items: [{ sku: "SKU-1" }] });
  });
  it("removes TikTok user identifiers and equivalent identity keys from every nested payload", () => {
    const payload = sanitizeMarketplaceRawPayload({ order_id: "o1", user_id: "seller", buyer_user_id: "buyer", nested: { userId: "camel", user_uuid: "uuid", safe: true }, items: [{ user_identifier: "identifier", sku: "SKU-1" }] });
    expect(payload).toEqual({ order_id: "o1", nested: { safe: true }, items: [{ sku: "SKU-1" }] });
    expect(JSON.stringify(payload)).not.toContain("user_id");
  });
});
