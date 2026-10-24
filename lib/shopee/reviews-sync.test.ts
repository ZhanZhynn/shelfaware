import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() });
  return { shop: model(), reviews: model(), collections: model(), products: model(), orders: model(), getComment: vi.fn(), sdk: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: m.shop, shopeeReview: m.reviews, shopeeReviewCollection: m.collections, shopeeProduct: m.products, shopeeOrder: m.orders } }));
vi.mock("./server", () => ({ getShopeeSDK: m.sdk }));
import { relinkShopeeReviews, syncShopeeReviewPage } from "./reviews-sync";

const raw = (comment_id: number, extra = {}) => ({ comment_id, item_id: 456, order_sn: "ORDER-1", comment: "Good packaging", rating_star: 5, create_time: 1700000000, hidden: false, model_id_list: [], ...extra });
const store = new Map<string, Record<string, unknown>>();
beforeEach(() => {
  vi.resetAllMocks(); store.clear();
  m.shop.findFirst.mockResolvedValue({ id: "shop-db", shopId: 123 });
  m.sdk.mockReturnValue({ product: { getComment: m.getComment } });
  m.getComment.mockResolvedValue({ request_id: "review-request", response: { item_comment_list: [raw(1)], more: false, next_cursor: "" } });
  m.products.findMany.mockResolvedValue([{ id: "product-db", shopeeItemId: 456 }]); m.orders.findMany.mockResolvedValue([{ id: "order-db", shopeeOrderId: "ORDER-1" }]);
  m.collections.findUnique.mockResolvedValue({ sourceRunId: "run" }); m.collections.updateMany.mockResolvedValue({ count: 1 });
  m.reviews.findMany.mockImplementation(async ({ where }) => where.externalId ? [...store.values()].filter((row) => where.externalId.in.includes(row.externalId)) : []);
  m.reviews.upsert.mockImplementation(async ({ create, update }) => { const prior = store.get(create.externalId); const result = { ...prior, ...(prior ? update : create) }; store.set(create.externalId, result); return result; });
  m.reviews.updateMany.mockResolvedValue({ count: 1 });
});

describe("independent review page sync", () => {
  it("upserts edits/replies idempotently and links only owned stable identifiers", async () => {
    expect(await syncShopeeReviewPage(123, "owner", {}, null, "run")).toMatchObject({ created: 1, updated: 0, done: true, limited: false });
    m.getComment.mockResolvedValue({ response: { item_comment_list: [raw(1, { comment: "Edited review", cmt_reply: { reply: "Thank you", hidden: false } })], more: false, next_cursor: "" } });
    expect(await syncShopeeReviewPage(123, "owner", {}, null, "run-2")).toMatchObject({ created: 0, updated: 1, changed: 1 });
    expect(store.size).toBe(1); expect(store.get("1")).toMatchObject({ productId: "product-db", orderId: "order-db", text: "Edited review", replyState: "returned" });
    expect(m.products.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: "shop-db", userId: "owner", shopeeItemId: { in: [456] } } }));
  });
  it("keeps feedback with missing or ambiguous parents and resolves it on later refresh", async () => {
    m.products.findMany.mockResolvedValue([{ id: "product-a", shopeeItemId: 456 }, { id: "product-b", shopeeItemId: 456 }]); m.orders.findMany.mockResolvedValue([]);
    await syncShopeeReviewPage(123, "owner", {}, null, "run");
    expect(store.get("1")).toMatchObject({ productId: null, orderId: null, text: "Good packaging" });
    m.products.findMany.mockResolvedValue([{ id: "product-db", shopeeItemId: 456 }]); m.orders.findMany.mockResolvedValue([{ id: "order-db", shopeeOrderId: "ORDER-1" }]);
    await syncShopeeReviewPage(123, "owner", {}, null, "run-2");
    expect(store.get("1")).toMatchObject({ productId: "product-db", orderId: "order-db" });
  });
  it("checkpoints pages without stopping at an already stored review", async () => {
    m.getComment.mockResolvedValueOnce({ response: { item_comment_list: [raw(1), raw(2)], more: true, next_cursor: "next" } }).mockResolvedValueOnce({ response: { item_comment_list: [raw(2), raw(3)], more: false, next_cursor: "" } });
    const first = await syncShopeeReviewPage(123, "owner", {}, null, "run"); expect(first.done).toBe(false);
    const second = await syncShopeeReviewPage(123, "owner", {}, first.checkpoint, "run");
    expect(second.checkpoint.ids).toEqual(["1", "2", "3"]); expect(second.checkpoint.records).toBe(4); expect(store.size).toBe(3);
    expect(m.getComment.mock.calls[1]![0].cursor).toBe("next");
  });
  it.each([true, false])("treats the 1000 boundary as limited even when more=%s", async (more) => {
    const checkpoint = { v: 1, cursor: "last", pages: 9, records: 999, ids: Array.from({ length: 999 }, (_, i) => String(i + 1)), cursors: [""], requestIds: [] };
    m.getComment.mockResolvedValue({ response: { item_comment_list: [raw(1000)], more, next_cursor: "" } });
    const result = await syncShopeeReviewPage(123, "owner", {}, checkpoint, "run");
    expect(result).toMatchObject({ done: true, limited: true, terminationReason: "documented_cap_boundary" });
    expect(m.collections.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "limited", uniqueReviewsObserved: 1000 }) }));
  });
  it("rejects stalled cursors without pretending collection is complete", async () => {
    m.getComment.mockResolvedValue({ response: { item_comment_list: [raw(1)], more: true, next_cursor: "" } });
    await expect(syncShopeeReviewPage(123, "owner", {}, null, "run")).rejects.toMatchObject({ code: "REVIEW_PAGINATION_STALLED", retryable: false });
    expect(store.size).toBe(1); expect(m.collections.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "partial" }) }));
  });
  it("checks shop/product scope and collection ownership before unsafe writes", async () => {
    await expect(syncShopeeReviewPage(123, "owner", { itemId: "789" }, null, "run")).rejects.toMatchObject({ code: "REVIEW_PRODUCT_SCOPE_MISMATCH" });
    expect(m.reviews.upsert).not.toHaveBeenCalled();
    m.shop.findFirst.mockResolvedValue(null); await expect(syncShopeeReviewPage(123, "owner", {}, null, "run")).rejects.toThrow("REVIEW_SHOP_NOT_FOUND");
  });
  it("records safe authentication failures without review/customer content", async () => {
    m.getComment.mockRejectedValue(new Error('API Error: {"error":"error_auth","message":"access_token=private"}'));
    await expect(syncShopeeReviewPage(123, "owner", {}, null, "run")).rejects.toMatchObject({ code: "REVIEW_PROVIDER_AUTH_REQUIRED" });
    expect(JSON.stringify(m.collections.updateMany.mock.calls)).not.toContain("access_token");
  });
  it("rotates retained unlinked records without changing review observation time", async () => {
    m.reviews.findMany.mockResolvedValueOnce([{ id: "review-db", itemExternalId: "456", orderExternalId: "ORDER-1" }]);
    expect(await relinkShopeeReviews("shop-db", "owner")).toBe(1);
    expect(m.reviews.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "review-db", shopId: "shop-db", userId: "owner" }, data: { productId: "product-db", orderId: "order-db", linkCheckedAt: expect.any(Date) } }));
  });
});
