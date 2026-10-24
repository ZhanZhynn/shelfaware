import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ shop: vi.fn(), collections: vi.fn(), stats: vi.fn(), rows: vi.fn(), cursor: vi.fn(), groups: vi.fn(), products: vi.fn(), owners: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: m.shop }, shopeeReviewCollection: { findMany: m.collections }, shopeeReview: { aggregate: m.stats, findMany: m.rows, findFirst: m.cursor, groupBy: m.groups }, shopeeProduct: { findMany: m.products } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: m.owners }));
import { getShopeeReviews, parseReviewFilters, reviewCursor } from "./reviews-report";
const shopId = "6a48e5373d977c22b78e267c";
const recordId = "6a48e5373d977c22b78e267d";
const actor = { id: "actor", role: "admin" };
const query = (extra = "") => new URLSearchParams(`shopId=${shopId}${extra}`);
beforeEach(() => {
  vi.resetAllMocks();
  m.owners.mockResolvedValue(["owner"]); m.shop.mockResolvedValue({ id: shopId, shopId: 265951653 });
  m.collections.mockResolvedValue([{ scopeKey: "shop", state: "observed", sourceRunId: "run", uniqueReviewsObserved: 3, providerLimited: false, observedAt: new Date("2026-10-24"), completedAt: new Date("2026-10-24") }]);
  m.stats.mockResolvedValue({ _count: { _all: 3, rating: 2, text: 2, productId: 1, orderId: 1, sourceCreatedAt: 2 }, _min: { sourceCreatedAt: new Date("2026-09-01"), observedAt: new Date("2026-10-23") }, _max: { sourceCreatedAt: new Date("2026-09-02"), observedAt: new Date("2026-10-24") } });
  m.rows.mockImplementation(async ({ select }) => select.id ? [{ id: recordId, externalId: "12345678901234567890", itemExternalId: "456", orderExternalId: "PRIVATE_ORDER", productId: null, orderId: null, rating: 5, text: "Good packaging", sourceCreatedAt: new Date("2026-09-01"), sourceUpdatedAt: null, observedAt: new Date("2026-10-24"), firstObservedAt: new Date("2026-10-23"), lastChangedAt: new Date("2026-10-23") }] : [{ text: "Good packaging" }, { text: "Delivery late" }]);
  m.cursor.mockResolvedValue({ id: recordId });
  m.groups.mockImplementation(async ({ by }) => by[0] === "rating" ? [{ rating: 1, _count: { _all: 1 } }, { rating: 5, _count: { _all: 1 } }, { rating: null, _count: { _all: 1 } }] : by[0] === "hasText" ? [{ hasText: true, _count: { _all: 2 } }, { hasText: null, _count: { _all: 1 } }] : by[0] === "replyState" ? [{ replyState: "returned", _count: { _all: 1 } }, { replyState: "not_returned", _count: { _all: 2 } }] : [{ itemExternalId: "456", _count: { id: 3, rating: 2 }, _avg: { rating: 3 } }]);
  m.products.mockResolvedValue([{ id: "product-db", shopeeItemId: 456, itemName: "Boxes", itemSku: "BOX" }]);
});
describe("stored review reports", () => {
  it("uses collected rated reviews as the denominator and labels keyword mentions", async () => {
    const report = await getShopeeReviews(actor, query(), "summary");
    expect(report.data).toMatchObject({ reviewCount: 3, ratedReviewCount: 2, averageRating: 3, lowRatingCount: 1, unavailableRatingCount: 1, withoutReturnedReplyCount: 2, linkedProductReviews: 1, linkedOrderReviews: 1, topicAnalysis: { method: "keyword_mentions_not_sentiment", reviewsAnalyzed: 2, topicMentions: { packaging: 1, delivery: 1 } } });
    expect(report.coverage.historyCompleteness).toBe("unknown");
    expect(m.shop).toHaveBeenCalledWith(expect.objectContaining({ where: { id: shopId, userId: { in: ["owner"] } } }));
  });
  it("exposes text and safe links without structured order or buyer identity", async () => {
    const report = await getShopeeReviews(actor, query(), "list");
    expect(report.data).toEqual([expect.objectContaining({ externalId: "12345678901234567890", text: "Good packaging", links: { product: "unlinked", order: "unlinked" } })]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_ORDER");
    expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({ take: 51, where: expect.objectContaining({ shopId, userId: { in: ["owner"] } }) }));
  });
  it("binds list cursors to filters and verifies the cursor belongs to owned data", async () => {
    const cursor = reviewCursor(parseReviewFilters(query()), recordId);
    await getShopeeReviews(actor, query(`&cursor=${cursor}&limit=100`), "list");
    expect(m.cursor).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: recordId, shopId }) }));
    await expect(getShopeeReviews(actor, query(`&cursor=${cursor}&rating=1`), "list")).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    m.cursor.mockResolvedValue(null);
    await expect(getShopeeReviews(actor, query(`&cursor=${cursor}`), "list")).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("marks missing/limited snapshots and never calls the collected rating official", async () => {
    m.collections.mockResolvedValue([]);
    const missing = await getShopeeReviews(actor, query(), "status"); expect(missing.coverage.state).toBe("missing");
    m.collections.mockResolvedValue([{ scopeKey: "shop", state: "limited", uniqueReviewsObserved: 1000, providerLimited: true }]);
    const limited = await getShopeeReviews(actor, query(), "summary"); expect(limited.coverage).toMatchObject({ state: "limited", availableWindowReviews: 1000, ratingPopulation: "stored_reviews_matching_filters" });
    expect(limited.warnings.some((message) => message.includes("limit"))).toBe(true);
  });
  it("filters by provider creation time and respects an explicit no-text query", async () => {
    await getShopeeReviews(actor, query("&createdAfter=2026-09-01T00:00:00%2B08:00&hasText=false"), "summary");
    expect(m.groups).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sourceCreatedAt: { gte: new Date("2026-08-31T16:00:00Z") }, hasText: false }) }));
    expect(m.rows).not.toHaveBeenCalled();
  });
  it.each([["[", "\\["], [".*", "\\.\\*"], ["box (large)", "box \\(large\\)"], ["a+b", "a\\+b"], ["back\\slash", "back\\\\slash"]])("escapes MongoDB regex metacharacters for literal search: %s", async (search, escaped) => {
    await getShopeeReviews(actor, query(`&search=${encodeURIComponent(search)}`), "list");
    expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ text: { contains: escaped, mode: "insensitive" } }) }));
  });
  it("returns bounded per-product rankings with optional product metadata", async () => {
    const report = await getShopeeReviews(actor, query("&limit=1"), "products");
    expect(report.data).toEqual([expect.objectContaining({ itemExternalId: "456", title: "Boxes", reviewCount: 3, averageRating: 3 })]);
    m.products.mockResolvedValue([]);
    expect((await getShopeeReviews(actor, query(), "products")).data).toEqual([expect.objectContaining({ productId: null, title: null, itemExternalId: "456" })]);
  });
  it.each(["rating=0", "rating=5&ratingMax=2", "hasText=maybe", "createdAfter=2026-09-01", "createdAfter=2026-09-01T00:00:00.001Z", "createdAfter=2026-09-02T00:00:00Z&createdBefore=2026-09-01T00:00:00Z", "shopId=bad", "limit=101", "unknown=field"])("rejects invalid filters: %s", (filter) => {
    expect(() => parseReviewFilters(new URLSearchParams(filter.startsWith("shopId=") ? filter : `shopId=${shopId}&${filter}`))).toThrow();
  });
  it("blocks unowned shops and incompatible report controls", async () => {
    m.shop.mockResolvedValue(null);
    await expect(getShopeeReviews(actor, query(), "list")).rejects.toMatchObject({ status: 404 }); expect(m.rows).not.toHaveBeenCalled();
    await expect(getShopeeReviews(actor, query(), "unknown")).rejects.toMatchObject({ status: 404 });
    await expect(getShopeeReviews(actor, query("&cursor=x"), "summary")).rejects.toThrow();
    await expect(getShopeeReviews(actor, query("&limit=1"), "status")).rejects.toThrow();
  });
});
