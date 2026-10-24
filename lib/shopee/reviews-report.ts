import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import type { AdminDataActor } from "@/lib/admin/data-scope";
import { reviewTopics } from "./reviews-domain";

export class ReviewReportError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); }
}
const id = z.string().regex(/^[a-f\d]{24}$/i);
const external = z.string().regex(/^[1-9]\d{0,63}$/);
const timestamp = z.string().datetime({ offset: true }).refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
const boolean = z.enum(["true", "false"]).transform((value) => value === "true");
const filtersSchema = z.object({ shopId: id, itemId: external.optional(), rating: z.coerce.number().int().min(1).max(5).optional(), ratingMax: z.coerce.number().int().min(1).max(5).optional(), search: z.string().trim().min(1).max(200).optional(), unreplied: boolean.optional(), hasText: boolean.optional(), createdAfter: timestamp.optional(), createdBefore: timestamp.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(2048).optional() }).strict();
export type ReviewFilters = z.infer<typeof filtersSchema>;

export function parseReviewFilters(params: URLSearchParams): ReviewFilters {
  if ([...new Set(params.keys())].some((key) => params.getAll(key).length > 1)) throw new ReviewReportError("INVALID_FILTER", "Duplicate review filter");
  const result = filtersSchema.safeParse(Object.fromEntries(params));
  if (!result.success) throw new ReviewReportError("INVALID_FILTER", "Invalid review filters; use an internal shop ID and whole-second RFC3339 dates");
  const query = result.data;
  if (query.createdAfter && query.createdBefore && new Date(query.createdAfter) > new Date(query.createdBefore)) throw new ReviewReportError("INVALID_DATE_RANGE", "from must not be after to");
  if (query.rating && query.ratingMax && query.rating > query.ratingMax) throw new ReviewReportError("INVALID_FILTER", "rating exceeds ratingMax");
  return query;
}

function fingerprint(query: ReviewFilters) {
  const { limit: _limit, cursor: _cursor, ...filters } = query;
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex");
}

export function reviewCursor(query: ReviewFilters, recordId: string) {
  return Buffer.from(JSON.stringify({ v: 1, filter: fingerprint(query), id: recordId })).toString("base64url");
}

function cursorId(query: ReviewFilters) {
  if (!query.cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
    const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (parsed.v !== 1 || parsed.filter !== fingerprint(query) || !id.safeParse(parsed.id).success) throw new Error();
    return parsed.id as string;
  } catch { throw new ReviewReportError("INVALID_CURSOR", "Review cursor does not match the filters"); }
}

function whereFor(query: ReviewFilters, ownerIds: string[]) {
  return {
    shopId: query.shopId, userId: { in: ownerIds },
    ...(query.itemId ? { itemExternalId: query.itemId } : {}),
    ...(query.rating ? { rating: query.rating } : query.ratingMax ? { rating: { gte: 1, lte: query.ratingMax } } : {}),
    // Prisma's MongoDB contains filter uses a regex without escaping its input.
    ...(query.search ? { text: { contains: query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), mode: "insensitive" as const } } : {}),
    ...(query.hasText !== undefined ? { hasText: query.hasText } : {}),
    ...(query.unreplied !== undefined ? { replyState: query.unreplied ? "not_returned" : "returned" } : {}),
    ...(query.createdAfter || query.createdBefore ? { sourceCreatedAt: { ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}), ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}) } } : {}),
  };
}
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Read the accumulated corpus, not a fresh provider page or an official shop rating. */
export async function getShopeeReviews(actor: AdminDataActor, params: URLSearchParams, view: string) {
  if (!["list", "summary", "products", "status"].includes(view)) throw new ReviewReportError("NOT_FOUND", "Unknown review report", 404);
  if (view !== "list" && params.has("cursor")) throw new ReviewReportError("INVALID_FILTER", "Cursors are supported only for review lists");
  if (!["list", "products"].includes(view) && params.has("limit")) throw new ReviewReportError("INVALID_FILTER", "Limit is supported only for lists and product rankings");
  const query = parseReviewFilters(params);
  const ownerIds = await marketplaceOwnerIds(actor);
  const shop = await prisma.shopeeShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { id: true, shopId: true } });
  if (!shop) throw new ReviewReportError("NOT_FOUND", "Shop not found", 404);
  const where = whereFor(query, ownerIds);
  const [collections, stats] = await Promise.all([
    prisma.shopeeReviewCollection.findMany({ where: { shopId: shop.id, userId: { in: ownerIds }, scopeKey: { in: query.itemId ? ["shop", `product:${query.itemId}`] : ["shop"] } }, orderBy: { observedAt: "desc" } }),
    prisma.shopeeReview.aggregate({ where, _count: { _all: true, rating: true, text: true, productId: true, orderId: true, sourceCreatedAt: true }, _min: { sourceCreatedAt: true, observedAt: true }, _max: { sourceCreatedAt: true, observedAt: true } }),
  ]);
  const collection = collections[0];
  const state = !collection ? "missing" : collection.state === "collecting" ? "partial" : collection.state;
  const warnings = ["Ratings and topics describe collected reviews, not Shopee's official shop rating or certified complete history."];
  if (state === "limited") warnings.push("The provider/configured review-window limit was reached; older collected records are retained.");
  if (state === "missing" || state === "partial") warnings.push("Review collection is missing or incomplete; no stored matches does not establish that customers left no reviews.");
  const metadata = {
    filters: { ...query, cursor: undefined, providerShopId: String(shop.shopId), dateBasis: "provider_review_creation_time" },
    coverage: { state, historyCompleteness: "unknown", ratingPopulation: "stored_reviews_matching_filters", productScopeSynced: query.itemId ? collections.some((row) => row.scopeKey === `product:${query.itemId}` && row.completedAt !== null && ["observed", "limited"].includes(row.state)) : null, sourceScope: collection?.scopeKey ?? null, availableWindowReviews: collection?.uniqueReviewsObserved ?? null, providerLimited: collection?.providerLimited ?? null },
    freshness: { latestCollectionObservedAt: iso(collection?.observedAt), latestCollectionCompletedAt: iso(collection?.completedAt), latestReviewObservedAt: iso(stats._max.observedAt), oldestReviewObservedAt: iso(stats._min.observedAt), oldestCollectedReviewAt: iso(stats._min.sourceCreatedAt), newestCollectedReviewAt: iso(stats._max.sourceCreatedAt) },
    warnings,
  };
  if (view === "status") return { ...metadata, data: { storedReviewCount: stats._count._all, linkedProductReviews: stats._count.productId, linkedOrderReviews: stats._count.orderId, reviewsWithoutSourceTime: stats._count._all - stats._count.sourceCreatedAt, collections: collections.map((row) => ({ scopeKey: row.scopeKey, state: row.state, sourceRunId: row.sourceRunId, pagesObserved: row.pagesObserved, recordsObserved: row.recordsObserved, uniqueReviewsObserved: row.uniqueReviewsObserved, providerMore: row.providerMore, providerLimited: row.providerLimited, terminationReason: row.terminationReason, lastError: row.lastError, diagnostics: row.diagnostics, observedAt: iso(row.observedAt), completedAt: iso(row.completedAt) })) } };
  if (view === "list") {
    const cursor = cursorId(query);
    if (cursor && !await prisma.shopeeReview.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw new ReviewReportError("INVALID_CURSOR", "Review cursor is outside the selected data");
    const rows = await prisma.shopeeReview.findMany({ where, orderBy: [{ sourceCreatedAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: query.limit + 1,
      select: { id: true, externalId: true, itemExternalId: true, variantExternalIds: true, orderExternalId: true, productId: true, orderId: true, rating: true, text: true, hasText: true, textTruncated: true, hidden: true, sellerReply: true, replyState: true, media: true, sourceCreatedAt: true, sourceUpdatedAt: true, firstObservedAt: true, observedAt: true, lastChangedAt: true } });
    const page = rows.slice(0, query.limit);
    return { ...metadata, data: page.map(({ orderExternalId, ...row }) => ({ ...row, sourceCreatedAt: iso(row.sourceCreatedAt), sourceUpdatedAt: iso(row.sourceUpdatedAt), observedAt: iso(row.observedAt), firstObservedAt: iso(row.firstObservedAt), lastChangedAt: iso(row.lastChangedAt), links: { product: row.productId ? "linked" : row.itemExternalId ? "unlinked" : "reference_unavailable", order: row.orderId ? "linked" : orderExternalId ? "unlinked" : "reference_unavailable" } })), page: { limit: query.limit, total: stats._count._all, nextCursor: rows.length > query.limit && page.length ? reviewCursor(query, page[page.length - 1]!.id) : null } };
  }
  if (view === "summary") {
    const [ratings, textGroups, replies, texts] = await Promise.all([
      prisma.shopeeReview.groupBy({ by: ["rating"], where, _count: { _all: true } }),
      prisma.shopeeReview.groupBy({ by: ["hasText"], where, _count: { _all: true } }),
      prisma.shopeeReview.groupBy({ by: ["replyState"], where, _count: { _all: true } }),
      query.hasText === false ? Promise.resolve([]) : prisma.shopeeReview.findMany({ where: { ...where, hasText: true }, orderBy: [{ sourceCreatedAt: "desc" }, { id: "desc" }], take: 1000, select: { text: true } }),
    ]);
    const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [rating, ratings.find((group) => group.rating === rating)?._count._all ?? 0]));
    const ratedCount = Object.values(distribution).reduce((sum, count) => sum + count, 0);
    const ratingSum = Object.entries(distribution).reduce((sum, [rating, count]) => sum + Number(rating) * count, 0);
    const textCount = textGroups.find((group) => group.hasText === true)?._count._all ?? 0;
    const usable = texts.map((row) => row.text).filter((text): text is string => typeof text === "string");
    return { ...metadata, data: { reviewCount: stats._count._all, ratedReviewCount: ratedCount, averageRating: ratedCount ? Math.round(ratingSum / ratedCount * 100) / 100 : null, ratingDistribution: distribution, unavailableRatingCount: stats._count._all - ratedCount, lowRatingCount: distribution[1]! + distribution[2]!, textReviewCount: textCount, unavailableTextCount: stats._count._all - stats._count.text, withReturnedReplyCount: replies.find((group) => group.replyState === "returned")?._count._all ?? 0, withoutReturnedReplyCount: replies.find((group) => group.replyState === "not_returned")?._count._all ?? 0, linkedProductReviews: stats._count.productId, linkedOrderReviews: stats._count.orderId, topicAnalysis: { method: "keyword_mentions_not_sentiment", reviewsAnalyzed: usable.length, matchingTextReviews: textCount, sampleLimited: textCount > usable.length, topicMentions: reviewTopics(usable) } } };
  }
  const groups = await prisma.shopeeReview.groupBy({ by: ["itemExternalId"], where, _count: { id: true, rating: true }, _avg: { rating: true }, orderBy: [{ _count: { id: "desc" } }, { itemExternalId: "asc" }], take: query.limit + 1 });
  const page = groups.slice(0, query.limit);
  const ids = page.map((row) => row.itemExternalId).filter((value): value is string => value !== null && Number.isSafeInteger(Number(value))).map(Number);
  const products = ids.length ? await prisma.shopeeProduct.findMany({ where: { shopId: shop.id, userId: { in: ownerIds }, shopeeItemId: { in: ids } }, select: { id: true, shopeeItemId: true, itemName: true, itemSku: true } }) : [];
  return { ...metadata, data: page.map((group) => { const matches = products.filter((row) => String(row.shopeeItemId) === group.itemExternalId); const product = matches.length === 1 ? matches[0] : undefined; return { itemExternalId: group.itemExternalId, productId: product?.id ?? null, title: product?.itemName ?? null, sku: product?.itemSku ?? null, reviewCount: group._count.id, ratedReviewCount: group._count.rating, averageRating: group._avg.rating === null ? null : Math.round(group._avg.rating * 100) / 100 }; }), page: { limit: query.limit, returned: page.length, hasMore: groups.length > query.limit, nextCursor: null } };
}
