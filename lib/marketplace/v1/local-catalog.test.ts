import { describe, expect, it, vi } from "vitest";

vi.mock("@/prisma/client", () => ({ prisma: {} }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: vi.fn() }));

import { decodeMarketplaceCursor, encodeMarketplaceCursor, MarketplaceV1ValidationError, parseLocalQuery } from "./local-catalog";

describe("v1 local marketplace queries", () => {
  it("parses strict order filters", () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId: "a".repeat(24), status: "READY_TO_SHIP", limit: "25", createdAfter: "2026-01-01T00:00:00.000Z" }), "orders");
    expect(query).toMatchObject({ shopId: "a".repeat(24), status: "READY_TO_SHIP", limit: 25 });
  });

  it("rejects duplicate, unknown, and inverted filters", () => {
    expect(() => parseLocalQuery(new URLSearchParams("limit=1&limit=2"), "orders")).toThrow(MarketplaceV1ValidationError);
    expect(() => parseLocalQuery(new URLSearchParams("page=1"), "orders")).toThrow(MarketplaceV1ValidationError);
    expect(() => parseLocalQuery(new URLSearchParams({ createdAfter: "2026-02-01T00:00:00.000Z", createdBefore: "2026-01-01T00:00:00.000Z" }), "orders")).toThrow(MarketplaceV1ValidationError);
  });

  it("binds cursors to their resource, platform, and filters", () => {
    const query = parseLocalQuery(new URLSearchParams({ shopId: "a".repeat(24), status: "READY_TO_SHIP" }), "orders");
    const cursor = encodeMarketplaceCursor("shopee", "orders", query, "b".repeat(24));

    expect(decodeMarketplaceCursor("shopee", "orders", query, cursor)).toBe("b".repeat(24));
    expect(() => decodeMarketplaceCursor("lazada", "orders", query, cursor)).toThrow(MarketplaceV1ValidationError);
    expect(() => decodeMarketplaceCursor("shopee", "products", query, cursor)).toThrow(MarketplaceV1ValidationError);
  });
});
