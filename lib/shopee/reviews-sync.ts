import { prisma } from "@/prisma/client";
import { toInputJson } from "@/lib/marketplace/json";
import { getShopeeSDK } from "./server";
import { REVIEW_LIMIT, REVIEW_MAX_PAGES, REVIEW_PAGE_SIZE, ShopeeReviewError, classifyReviewError, normalizeReview, reviewCheckpoint, reviewObject, reviewOptions } from "./reviews-domain";

type Links = { itemExternalId: string | null; orderExternalId: string | null };
function unambiguousLinks<T extends { id: string }>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, string>(); const ambiguous = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (result.has(value)) { result.delete(value); ambiguous.add(value); }
    else if (!ambiguous.has(value)) result.set(value, row.id);
  }
  return result;
}
async function linkMaps(shopId: string, userId: string, reviews: Links[]) {
  const itemIds = [...new Set(reviews.map((row) => row.itemExternalId).filter((id): id is string => id !== null && Number.isSafeInteger(Number(id))).map(Number))];
  const orderIds = [...new Set(reviews.map((row) => row.orderExternalId).filter((id): id is string => id !== null))];
  const [products, orders] = await Promise.all([
    itemIds.length ? prisma.shopeeProduct.findMany({ where: { shopId, userId, shopeeItemId: { in: itemIds } }, select: { id: true, shopeeItemId: true } }) : [],
    orderIds.length ? prisma.shopeeOrder.findMany({ where: { shopId, userId, shopeeOrderId: { in: orderIds } }, select: { id: true, shopeeOrderId: true } }) : [],
  ]);
  return { products: unambiguousLinks(products, (row) => String(row.shopeeItemId)), orders: unambiguousLinks(orders, (row) => row.shopeeOrderId) };
}

async function bounded<T>(values: T[], operation: (value: T) => Promise<unknown>) {
  for (let index = 0; index < values.length; index += 10) await Promise.all(values.slice(index, index + 10).map(operation));
}

/** Re-check a rotating bounded set of retained reviews, even after they leave the provider window. */
export async function relinkShopeeReviews(shopId: string, userId: string) {
  const rows = await prisma.shopeeReview.findMany({
    where: { shopId, userId, OR: [
      { itemExternalId: { not: null }, OR: [{ productId: null }, { productId: { isSet: false } }] },
      { orderExternalId: { not: null }, OR: [{ orderId: null }, { orderId: { isSet: false } }] },
    ] },
    orderBy: [{ linkCheckedAt: "asc" }, { id: "asc" }], take: 200,
    select: { id: true, itemExternalId: true, orderExternalId: true },
  });
  if (!rows.length) return 0;
  const links = await linkMaps(shopId, userId, rows);
  await bounded(rows, (row) => prisma.shopeeReview.updateMany({ where: { id: row.id, shopId, userId }, data: { productId: row.itemExternalId ? links.products.get(row.itemExternalId) ?? null : null, orderId: row.orderExternalId ? links.orders.get(row.orderExternalId) ?? null : null, linkCheckedAt: new Date() } }));
  return rows.length;
}

/** Fetch and settle one provider page. The durable task owns pagination checkpoints. */
export async function syncShopeeReviewPage(shopId: number, userId: string, input: unknown, checkpoint: unknown, sourceRunId: string) {
  const shop = await prisma.shopeeShop.findFirst({ where: { shopId, userId }, select: { id: true, shopId: true } });
  if (!shop) throw new ShopeeReviewError("REVIEW_SHOP_NOT_FOUND");
  const options = reviewOptions(input);
  const previous = reviewCheckpoint(checkpoint, options);
  const scopeKey = options.itemId ? `product:${options.itemId}` : "shop";
  const key = { shopId: shop.id, scopeKey };
  const now = new Date();
  if (previous.pages === 0) {
    const data = { userId, itemExternalId: options.itemId ?? null, sourceRunId, state: "collecting", pagesObserved: 0, recordsObserved: 0, uniqueReviewsObserved: 0, providerMore: null, providerLimited: false, terminationReason: null, lastError: null, diagnostics: toInputJson({ historyCompleteness: "unknown", requestedLimit: options.maxReviews }), startedAt: now, observedAt: now, completedAt: null };
    await prisma.shopeeReviewCollection.upsert({ where: { shopId_scopeKey: key }, create: { ...key, ...data }, update: data });
  } else {
    const collection = await prisma.shopeeReviewCollection.findUnique({ where: { shopId_scopeKey: key }, select: { sourceRunId: true } });
    if (collection?.sourceRunId !== sourceRunId) throw new ShopeeReviewError("REVIEW_COLLECTION_CONFLICT", true);
  }
  try {
    const remaining = options.maxReviews - previous.ids.length;
    if (remaining <= 0 || previous.pages >= REVIEW_MAX_PAGES) throw new ShopeeReviewError("REVIEW_CHECKPOINT_INVALID");
    const pageSize = Math.min(REVIEW_PAGE_SIZE, remaining);
    const sdk = getShopeeSDK(shopId);
    const envelope = reviewObject(await sdk.product.getComment({ cursor: previous.cursor, page_size: pageSize, ...(options.itemId ? { item_id: Number(options.itemId) } : {}) }));
    if (envelope.error) throw classifyReviewError(new Error(JSON.stringify({ error: envelope.error, request_id: envelope.request_id })));
    const body = reviewObject(envelope.response);
    if (!Array.isArray(body.item_comment_list) || body.item_comment_list.length > pageSize || typeof body.more !== "boolean") throw new ShopeeReviewError("REVIEW_RESPONSE_INVALID");
    const observedAt = new Date();
    const normalized = body.item_comment_list.map(normalizeReview);
    if (options.itemId && normalized.some((row) => row.itemExternalId !== options.itemId)) throw new ShopeeReviewError("REVIEW_PRODUCT_SCOPE_MISMATCH");
    const page = [...new Map(normalized.map((row) => [row.externalId, row])).values()];
    const [links, existing] = await Promise.all([
      linkMaps(shop.id, userId, page),
      prisma.shopeeReview.findMany({ where: { shopId: shop.id, externalId: { in: page.map((row) => row.externalId) } }, select: { externalId: true, contentHash: true } }),
    ]);
    const hashes = new Map(existing.map((row) => [row.externalId, row.contentHash]));
    const requestId = typeof envelope.request_id === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(envelope.request_id) ? envelope.request_id : null;
    let created = 0; let updated = 0; let changed = 0;
    await bounded(page, async (review) => {
      const { sellerReply, media, variantExternalIds, providerMetadata, ...facts } = review;
      const data = { ...facts, userId, sourceRequestId: requestId, variantExternalIds: variantExternalIds === null ? null : toInputJson(variantExternalIds), sellerReply: sellerReply === null ? null : toInputJson(sellerReply), media: media === null ? null : toInputJson(media), providerMetadata: toInputJson(providerMetadata), productId: review.itemExternalId ? links.products.get(review.itemExternalId) ?? null : null, orderId: review.orderExternalId ? links.orders.get(review.orderExternalId) ?? null : null, observedAt, linkCheckedAt: new Date() };
      const prior = hashes.get(review.externalId);
      await prisma.shopeeReview.upsert({ where: { shopId_externalId: { shopId: shop.id, externalId: review.externalId } }, create: { shopId: shop.id, ...data, firstObservedAt: observedAt, lastChangedAt: observedAt }, update: { ...data, ...(prior !== review.contentHash ? { lastChangedAt: observedAt } : {}) } });
      if (prior === undefined) created++; else updated++;
      if (prior !== undefined && prior !== review.contentHash) changed++;
    });
    const ids = [...new Set([...previous.ids, ...page.map((row) => row.externalId)])];
    const nextCursor = typeof body.next_cursor === "string" ? body.next_cursor : "";
    const progress = { v: 1, cursor: nextCursor, pages: previous.pages + 1, records: previous.records + normalized.length, ids, cursors: [...previous.cursors, previous.cursor], requestIds: [...previous.requestIds, ...(requestId ? [requestId] : [])] };
    const potentialCap = ids.length >= REVIEW_LIMIT || progress.records >= REVIEW_LIMIT || (progress.records === 500 && !body.more);
    const applicationLimit = ids.length >= options.maxReviews && body.more;
    const pageLimit = progress.pages >= REVIEW_MAX_PAGES && body.more;
    const done = !body.more || potentialCap || applicationLimit || pageLimit;
    const limited = potentialCap || applicationLimit || pageLimit;
    const reason = potentialCap ? "documented_cap_boundary" : applicationLimit ? "configured_limit" : pageLimit ? "page_limit" : done ? "end_of_available_pages" : null;
    const stalled = !done && body.more && (!nextCursor || nextCursor.length > 2048 || nextCursor === previous.cursor || previous.cursors.includes(nextCursor) || ids.length === previous.ids.length);
    const warning = Boolean(envelope.warning);
    const state = stalled || warning ? "partial" : done ? limited ? "limited" : "observed" : "collecting";
    const status = await prisma.shopeeReviewCollection.updateMany({ where: { ...key, sourceRunId }, data: { state, pagesObserved: progress.pages, recordsObserved: progress.records, uniqueReviewsObserved: ids.length, providerMore: body.more, providerLimited: limited, terminationReason: stalled ? "pagination_stalled" : warning ? "provider_warning" : reason, lastError: stalled ? "REVIEW_PAGINATION_STALLED" : warning ? "REVIEW_PROVIDER_WARNING" : null, diagnostics: toInputJson({ historyCompleteness: "unknown", requestedLimit: options.maxReviews, duplicatesObserved: progress.records - ids.length, sourceRequestIds: progress.requestIds, sourcePaginationExhausted: !body.more, fullHistoryCertified: false }), observedAt: new Date(), completedAt: done && !stalled && !warning ? new Date() : null } });
    if (status.count !== 1) throw new ShopeeReviewError("REVIEW_COLLECTION_CONFLICT", true);
    if (stalled) throw new ShopeeReviewError("REVIEW_PAGINATION_STALLED");
    if (warning) throw new ShopeeReviewError("REVIEW_PROVIDER_WARNING", true);
    const linksRechecked = done ? await relinkShopeeReviews(shop.id, userId) : 0;
    return { synced: page.length, created, updated, changed, errors: [] as string[], done, limited, terminationReason: reason, checkpoint: progress, linksRechecked };
  } catch (error) {
    const safe = classifyReviewError(error);
    await prisma.shopeeReviewCollection.updateMany({ where: { ...key, sourceRunId }, data: { state: "partial", lastError: safe.code, observedAt: new Date(), diagnostics: toInputJson({ historyCompleteness: "unknown", providerCode: safe.providerCode, providerRequestId: safe.providerRequestId }) } });
    throw safe;
  }
}
