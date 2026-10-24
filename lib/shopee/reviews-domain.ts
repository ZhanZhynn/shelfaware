import { createHash } from "node:crypto";

export const REVIEW_LIMIT = 1000;
export const REVIEW_PAGE_SIZE = 100;
export const REVIEW_MAX_PAGES = 20;
export const REVIEW_TEXT_LIMIT = 10_000;

export class ShopeeReviewError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly providerCode: string | null = null, readonly providerRequestId: string | null = null) { super(code); }
}

export function reviewObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShopeeReviewError("REVIEW_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

export function reviewIdentifier(value: unknown): string {
  if (typeof value === "string" && /^[1-9]\d{0,63}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new ShopeeReviewError("REVIEW_IDENTIFIER_INVALID");
}

function optionalIdentifier(value: unknown) {
  try { return reviewIdentifier(value); } catch { return null; }
}

function sourceTime(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function urls(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const candidate of value.slice(0, 30)) {
    if (typeof candidate !== "string" || candidate.length > 4096) return null;
    try { const url = new URL(candidate); if (!["http:", "https:"].includes(url.protocol)) return null; } catch { return null; }
    result.push(candidate);
  }
  return result;
}

export function normalizeReview(value: unknown) {
  const row = reviewObject(value);
  const externalId = reviewIdentifier(row.comment_id);
  const itemExternalId = optionalIdentifier(row.item_id);
  const orderExternalId = typeof row.order_sn === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(row.order_sn) ? row.order_sn : null;
  const rawText = typeof row.comment === "string" ? row.comment : null;
  const text = rawText?.slice(0, REVIEW_TEXT_LIMIT) ?? null;
  const rating = (typeof row.rating_star === "number" || typeof row.rating_star === "string") && /^[1-5]$/.test(String(row.rating_star)) ? Number(row.rating_star) : null;
  const variantSource = Array.isArray(row.model_id_list) ? row.model_id_list : row.model_id !== undefined ? [row.model_id] : null;
  const variantExternalIds = variantSource ? variantSource.map((id) => id === 0 || id === "0" ? "0" : optionalIdentifier(id)) : null;
  const variants = variantExternalIds?.every((id) => id !== null) ? variantExternalIds as string[] : null;
  const alias = row.comment_reply !== undefined && row.comment_reply !== null ? "comment_reply" : row.cmt_reply !== undefined && row.cmt_reply !== null ? "cmt_reply" : null;
  let sellerReply = null;
  let replyState = "not_returned";
  if (alias) {
    const reply = row[alias];
    if (reply && typeof reply === "object" && !Array.isArray(reply)) {
      const record = reply as Record<string, unknown>;
      sellerReply = { text: typeof record.reply === "string" ? record.reply.slice(0, REVIEW_TEXT_LIMIT) : null, textTruncated: typeof record.reply === "string" && record.reply.length > REVIEW_TEXT_LIMIT, hidden: typeof record.hidden === "boolean" ? record.hidden : null, createdAt: sourceTime(record.create_time)?.toISOString() ?? null };
      replyState = "returned";
    } else replyState = "unknown";
  }
  let media = null;
  if (row.media && typeof row.media === "object" && !Array.isArray(row.media)) {
    const record = row.media as Record<string, unknown>;
    const images = urls(record.image_url_list); const videos = urls(record.video_url_list);
    if (images !== null && videos !== null) media = { images, videos };
  }
  const canonical = { externalId, itemExternalId, orderExternalId, variantExternalIds: variants,
    rating, text, hasText: text === null ? null : text.trim().length > 0, textTruncated: rawText !== null && rawText.length > REVIEW_TEXT_LIMIT,
    hidden: typeof row.hidden === "boolean" ? row.hidden : null, sellerReply, replyState, media,
    sourceCreatedAt: sourceTime(row.create_time), sourceUpdatedAt: sourceTime(row.update_time ?? row.modify_time),
  };
  return { ...canonical, contentHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), providerMetadata: { editable: typeof row.editable === "string" ? row.editable.slice(0, 80) : null, replyAlias: alias, variantSource: Array.isArray(row.model_id_list) ? "model_id_list" : row.model_id !== undefined ? "model_id" : null } };
}

export function classifyReviewError(error: unknown): ShopeeReviewError {
  if (error instanceof ShopeeReviewError) return error;
  if (error instanceof Error && /^(Prisma|Mongo)/.test(error.name)) return new ShopeeReviewError("REVIEW_STORAGE_FAILED", true);
  const text = error instanceof Error ? error.message : String(error);
  const code = /"error"\s*:\s*"([A-Za-z0-9_.-]{1,64})"/.exec(text)?.[1] ?? null;
  const requestId = /"request_id"\s*:\s*"([A-Za-z0-9_.:-]{1,160})"/.exec(text)?.[1] ?? null;
  if (code && /auth|permission|token|sign|partner_shop_no_link|shop_banned/.test(code)) return new ShopeeReviewError("REVIEW_PROVIDER_AUTH_REQUIRED", false, code, requestId);
  if (code && /rate_limit|call_limit/.test(code)) return new ShopeeReviewError("REVIEW_PROVIDER_RATE_LIMIT", true, code, requestId);
  if (code && /error_param|not_found|unsupported/.test(code)) return new ShopeeReviewError("REVIEW_PROVIDER_REJECTED", false, code, requestId);
  return new ShopeeReviewError("REVIEW_PROVIDER_TEMPORARY", true, code, requestId);
}

export type ReviewOptions = { itemId?: string; maxReviews: number };
export function reviewOptions(input: unknown): ReviewOptions {
  const value = input === undefined || input === null ? {} : reviewObject(input);
  const itemId = value.itemId === undefined ? undefined : reviewIdentifier(value.itemId);
  if (itemId && !Number.isSafeInteger(Number(itemId))) throw new ShopeeReviewError("REVIEW_ITEM_ID_UNSUPPORTED");
  const maxReviews = value.maxReviews ?? REVIEW_LIMIT;
  if (typeof maxReviews !== "number" || !Number.isInteger(maxReviews) || maxReviews < 1 || maxReviews > REVIEW_LIMIT) throw new ShopeeReviewError("REVIEW_LIMIT_INVALID");
  return { itemId, maxReviews };
}

export type ReviewCheckpoint = { v: number; cursor: string; pages: number; records: number; ids: string[]; cursors: string[]; requestIds: string[] };
export function reviewCheckpoint(input: unknown, options: ReviewOptions): ReviewCheckpoint {
  if (!input) return { v: 1, cursor: "", pages: 0, records: 0, ids: [], cursors: [], requestIds: [] };
  const value = reviewObject(input);
  if (value.v !== 1 || typeof value.cursor !== "string" || value.cursor.length > 2048 || !Number.isInteger(value.pages) || Number(value.pages) < 0 || Number(value.pages) > REVIEW_MAX_PAGES || !Number.isInteger(value.records) || Number(value.records) < 0 || !Array.isArray(value.ids) || value.ids.length > options.maxReviews || !Array.isArray(value.cursors) || value.cursors.length > REVIEW_MAX_PAGES || value.cursors.some((cursor) => typeof cursor !== "string" || cursor.length > 2048) || !Array.isArray(value.requestIds) || value.requestIds.length > REVIEW_MAX_PAGES) throw new ShopeeReviewError("REVIEW_CHECKPOINT_INVALID");
  const ids = value.ids.map(reviewIdentifier);
  if (new Set(ids).size !== ids.length) throw new ShopeeReviewError("REVIEW_CHECKPOINT_INVALID");
  return { v: 1, cursor: value.cursor, pages: Number(value.pages), records: Number(value.records), ids, cursors: value.cursors as string[], requestIds: value.requestIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(id)) };
}

const topics = {
  quality: /\b(quality|kualiti|defect|damaged|rosak)\b|质量|品質|损坏|瑕疵/iu,
  packaging: /\b(packaging|packed|packing|bungkus|pembungkusan)\b|包装|包裝/iu,
  delivery: /\b(delivery|shipping|arrived|penghantaran|sampai|courier)\b|物流|发货|配送|快递/iu,
  value: /\b(price|harga|cheap|murah|expensive|mahal|berbaloi)\b|价格|便宜|划算/iu,
  sellerService: /\b(seller|penjual|service|layanan|responsive)\b|客服|卖家|服務/iu,
};
export function reviewTopics(texts: string[]) {
  return Object.fromEntries(Object.entries(topics).map(([topic, pattern]) => [topic, texts.filter((text) => pattern.test(text)).length]));
}

export function publicReviewCheckpoint(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  return { version: value.v, pagesObserved: value.pages, recordsObserved: value.records, uniqueReviewsObserved: Array.isArray(value.ids) ? value.ids.length : null, cursorPresent: typeof value.cursor === "string" && value.cursor.length > 0 };
}
