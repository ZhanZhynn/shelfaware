import type { ItemStatus } from "@congminh1254/shopee-sdk/schemas";
import { z } from "zod";
import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { getTransientShopeeSDK } from "@/lib/shopee/server";
import { createLazadaShopContext } from "@/lib/lazada/server";
import { getOrdersCustom, getProductsCustom } from "@/lib/lazada/custom-api";
import { searchOrders, searchProducts } from "@/lib/tiktok/custom-api";
import { shopifyGraphQL } from "@/lib/shopify/server";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const objectId = /^[a-f\d]{24}$/i;
const platformSet = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const status = z.string().regex(/^[A-Za-z_]{1,64}$/).optional();
const common = {
  shopId: z.string().regex(objectId, "shopId must be an internal shop ID"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  // Provider cursors are opaque. Allow URL-safe values plus padded base64 used
  // by Shopify, while rejecting whitespace and query-language punctuation.
  cursor: z.string().regex(/^[A-Za-z0-9_+=/-]{1,1024}$/).optional(),
  status,
};
const orderSchema = z.object({
  ...common,
  createdAfter: z.string().datetime({ offset: true }).optional(),
  createdBefore: z.string().datetime({ offset: true }).optional(),
}).strict();
const productSchema = z.object(common).strict();

export type LiveResource = "orders" | "products";
export type LiveQuery = {
  shopId: string;
  limit: number;
  cursor?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
};
export type LiveListResult = { data: Array<Record<string, unknown>>; page: { limit: number; nextCursor: string | null } };

export class MarketplaceLiveValidationError extends Error {}
export class MarketplaceLiveNotFoundError extends Error {}

function duplicateQueryKey(params: URLSearchParams) {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/** Parse only bounded, provider-neutral filters. Provider query syntax is never accepted from callers. */
export function parseLiveQuery(params: URLSearchParams, resource: LiveResource): LiveQuery {
  const duplicate = duplicateQueryKey(params);
  if (duplicate) throw new MarketplaceLiveValidationError(`Duplicate query parameter: ${duplicate}`);
  const parsed = (resource === "orders" ? orderSchema : productSchema).safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new MarketplaceLiveValidationError("Invalid query parameters");
  const query = parsed.data as LiveQuery;
  if (resource === "orders") {
    // Always materialize a small window, including when callers omit one or
    // both bounds. This prevents an unbounded direct provider read.
    const end = query.createdBefore ? new Date(query.createdBefore) : new Date();
    const start = query.createdAfter ? new Date(query.createdAfter) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (start > end) throw new MarketplaceLiveValidationError("createdAfter must not be after createdBefore");
    if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new MarketplaceLiveValidationError("Date range must not exceed 31 days");
    }
    query.createdAfter = start.toISOString();
    query.createdBefore = end.toISOString();
  }
  return query;
}

const isoSeconds = (value: unknown) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
};
const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const defaultFrom = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const defaultTo = () => new Date().toISOString();

function nextOffset(cursor: string | undefined) {
  if (!cursor) return 0;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new MarketplaceLiveValidationError("Invalid cursor");
  return offset;
}

async function shopeeOrders(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.shopeeShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { shopId: true, accessToken: true, refreshToken: true, tokenExpiry: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const sdk = getTransientShopeeSDK(shop.shopId, {
    access_token: shop.accessToken, refresh_token: shop.refreshToken,
    expire_in: shop.tokenExpiry ? Math.max(0, Math.floor((shop.tokenExpiry.getTime() - Date.now()) / 1000)) : 14_400,
    request_id: "", error: "", message: "", expired_at: shop.tokenExpiry?.getTime(), shop_id: shop.shopId,
  });
  const response = (await sdk.order.getOrderList({
    time_range_field: "create_time",
    time_from: Math.floor(new Date(query.createdAfter ?? defaultFrom()).getTime() / 1000),
    time_to: Math.floor(new Date(query.createdBefore ?? defaultTo()).getTime() / 1000),
    page_size: query.limit,
    cursor: query.cursor ?? "",
  }) as unknown as { response?: { order_list?: unknown[]; more?: boolean; next_cursor?: string } }).response;
  const orders = (response?.order_list ?? []).map((item) => {
    const value = record(item);
    return { shopId: query.shopId, externalId: String(value.order_sn ?? ""), status: typeof value.order_status === "string" ? value.order_status : null, createdAt: isoSeconds(value.create_time), updatedAt: isoSeconds(value.update_time) };
  }).filter((item) => item.externalId);
  return { data: query.status ? orders.filter((item) => item.status === query.status) : orders, page: { limit: query.limit, nextCursor: response?.more && response.next_cursor ? response.next_cursor : null } };
}

async function shopeeProducts(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.shopeeShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { shopId: true, accessToken: true, refreshToken: true, tokenExpiry: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const sdk = getTransientShopeeSDK(shop.shopId, {
    access_token: shop.accessToken, refresh_token: shop.refreshToken,
    expire_in: shop.tokenExpiry ? Math.max(0, Math.floor((shop.tokenExpiry.getTime() - Date.now()) / 1000)) : 14_400,
    request_id: "", error: "", message: "", expired_at: shop.tokenExpiry?.getTime(), shop_id: shop.shopId,
  });
  const listed = (await sdk.product.getItemList({ offset: nextOffset(query.cursor), page_size: query.limit, item_status: [((query.status ?? "NORMAL") as ItemStatus)] }) as unknown as { response?: { item?: Array<{ item_id?: number }>; has_next_page?: boolean } }).response;
  const ids = (listed?.item ?? []).map((item) => Number(item.item_id)).filter(Number.isSafeInteger);
  const details = ids.length ? (await sdk.product.getItemBaseInfo({ item_id_list: ids }) as unknown as { response?: { item_list?: unknown[] } }).response?.item_list ?? [] : [];
  const data = details.map((item) => {
    const value = record(item);
    const price = Array.isArray(value.price_info) ? record(value.price_info[0]) : {};
    const stock = record(record(value.stock_info_v2).summary_info);
    const images = record(value.image).image_url_list;
    return { shopId: query.shopId, externalId: String(value.item_id ?? ""), title: typeof value.item_name === "string" ? value.item_name : null, sku: typeof value.item_sku === "string" ? value.item_sku : null, price: finiteNumber(price.current_price ?? price.original_price), originalPrice: finiteNumber(price.original_price), stock: finiteNumber(stock.total_available_stock), imageUrl: Array.isArray(images) && typeof images[0] === "string" ? images[0] : null, status: typeof value.item_status === "string" ? value.item_status : null, createdAt: isoSeconds(value.create_time), updatedAt: isoSeconds(value.update_time) };
  }).filter((item) => item.externalId);
  return { data, page: { limit: query.limit, nextCursor: listed?.has_next_page ? String(nextOffset(query.cursor) + ids.length) : null } };
}

async function lazadaOrders(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.lazadaShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const rows = await getOrdersCustom(createLazadaShopContext(shop), { created_after: query.createdAfter ?? defaultFrom(), created_before: query.createdBefore ?? defaultTo(), status: query.status, limit: query.limit, offset: nextOffset(query.cursor), sort_by: "created_at", sort_direction: "DESC" });
  const data = rows.map((item) => ({ shopId: query.shopId, externalId: String(item.order_id), reference: item.order_number || null, status: item.statuses?.[0] ?? null, totalAmount: finiteNumber(item.price), shippingAmount: finiteNumber(item.shipping_fee), createdAt: item.created_at || null, updatedAt: item.updated_at || null }));
  return { data, page: { limit: query.limit, nextCursor: rows.length === query.limit ? String(nextOffset(query.cursor) + rows.length) : null } };
}

async function lazadaProducts(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.lazadaShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const rows = await getProductsCustom(createLazadaShopContext(shop), { filter: (query.status as "all" | "live" | "inactive" | "deleted" | "pending" | "rejected" | "sold-out" | undefined) ?? "live", limit: query.limit, offset: nextOffset(query.cursor) });
  const data = rows.map((item) => {
    const sku = item.skus?.[0];
    return { shopId: query.shopId, externalId: String(item.item_id), title: item.attributes?.name ?? null, sku: sku?.SellerSku ?? null, price: finiteNumber(sku?.price), specialPrice: finiteNumber(sku?.special_price), stock: finiteNumber(sku?.quantity), imageUrl: item.images?.[0] ?? null, status: item.status ?? null, createdAt: item.created_time ?? null, updatedAt: item.updated_time ?? null };
  });
  return { data, page: { limit: query.limit, nextCursor: rows.length === query.limit ? String(nextOffset(query.cursor) + rows.length) : null } };
}

async function tiktokOrders(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.tikTokShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { accessToken: true, shopCipher: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const response = await searchOrders(shop.accessToken, shop.shopCipher, { order_status: query.status, create_time_ge: Math.floor(new Date(query.createdAfter ?? defaultFrom()).getTime() / 1000), create_time_lt: Math.floor(new Date(query.createdBefore ?? defaultTo()).getTime() / 1000) }, query.limit, query.cursor, "CREATE_TIME", "DESC");
  return { data: (response.orders ?? []).map((item) => ({ shopId: query.shopId, externalId: item.id, status: item.status, totalAmount: finiteNumber(item.payment?.total_amount), currency: item.payment?.currency ?? null, fulfillmentStatus: item.fulfillment_type ?? null, shippingType: item.shipping_type ?? null, createdAt: isoSeconds(item.create_time), updatedAt: isoSeconds(item.update_time) })), page: { limit: query.limit, nextCursor: response.next_page_token || null } };
}

async function tiktokProducts(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.tikTokShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { accessToken: true, shopCipher: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const response = await searchProducts(shop.accessToken, shop.shopCipher, { status: query.status }, query.limit, query.cursor);
  return { data: (response.products ?? []).map((item) => ({ shopId: query.shopId, externalId: item.product_id || item.id, title: item.title ?? null, sku: item.seller_sku ?? null, imageUrl: item.main_image_url ?? null, status: item.status ?? null, auditStatus: item.audit?.status ?? item.audit_status ?? null, createdAt: isoSeconds(item.create_time), updatedAt: isoSeconds(item.update_time) })), page: { limit: query.limit, nextCursor: response.next_page_token || null } };
}

const LIVE_PRODUCTS_QUERY = `query LiveProducts($first: Int!, $after: String, $query: String) { products(first: $first, after: $after, query: $query) { nodes { id title handle status totalInventory featuredImage { url } createdAt updatedAt variants(first: 1) { nodes { sku price compareAtPrice } } } pageInfo { hasNextPage endCursor } } }`;
const LIVE_ORDERS_QUERY = `query LiveOrders($first: Int!, $after: String, $query: String) { orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt updatedAt cancelledAt closed displayFinancialStatus displayFulfillmentStatus currencyCode totalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } }`;

async function shopifyProducts(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.shopifyShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { shopDomain: true, accessToken: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const response = await shopifyGraphQL<{ products: { nodes: Array<Record<string, any>>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(shop.shopDomain, shop.accessToken, LIVE_PRODUCTS_QUERY, { first: query.limit, after: query.cursor ?? null, query: query.status ? `status:${query.status}` : undefined });
  return { data: response.products.nodes.map((item) => { const variant = item.variants?.nodes?.[0]; return { shopId: query.shopId, externalId: item.id, title: item.title ?? null, handle: item.handle ?? null, sku: variant?.sku ?? null, price: finiteNumber(variant?.price), originalPrice: finiteNumber(variant?.compareAtPrice), stock: finiteNumber(item.totalInventory), imageUrl: item.featuredImage?.url ?? null, status: item.status ?? null, createdAt: item.createdAt ?? null, updatedAt: item.updatedAt ?? null }; }), page: { limit: query.limit, nextCursor: response.products.pageInfo.hasNextPage ? response.products.pageInfo.endCursor : null } };
}

async function shopifyOrders(query: LiveQuery, ownerIds: string[]): Promise<LiveListResult> {
  const shop = await prisma.shopifyShop.findFirst({ where: { id: query.shopId, userId: { in: ownerIds } }, select: { shopDomain: true, accessToken: true } });
  if (!shop) throw new MarketplaceLiveNotFoundError("Shop not found");
  const filters = [`created_at:>=${query.createdAfter ?? defaultFrom()}`];
  if (query.createdBefore) filters.push(`created_at:<=${query.createdBefore}`);
  if (query.status) filters.push(`status:${query.status}`);
  const response = await shopifyGraphQL<{ orders: { nodes: Array<Record<string, any>>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(shop.shopDomain, shop.accessToken, LIVE_ORDERS_QUERY, { first: query.limit, after: query.cursor ?? null, query: filters.join(" ") });
  return { data: response.orders.nodes.map((item) => ({ shopId: query.shopId, externalId: item.id, reference: item.name ?? null, status: item.cancelledAt ? "CANCELLED" : item.closed ? "CLOSED" : "OPEN", paymentStatus: item.displayFinancialStatus ?? null, fulfillmentStatus: item.displayFulfillmentStatus ?? null, totalAmount: finiteNumber(item.totalPriceSet?.shopMoney?.amount), currency: item.currencyCode ?? item.totalPriceSet?.shopMoney?.currencyCode ?? null, createdAt: item.createdAt ?? null, updatedAt: item.updatedAt ?? null })), page: { limit: query.limit, nextCursor: response.orders.pageInfo.hasNextPage ? response.orders.pageInfo.endCursor : null } };
}

const adapters = {
  shopee: { orders: shopeeOrders, products: shopeeProducts },
  lazada: { orders: lazadaOrders, products: lazadaProducts },
  tiktok: { orders: tiktokOrders, products: tiktokProducts },
  shopify: { orders: shopifyOrders, products: shopifyProducts },
} as const;

/** Direct provider reads only: no sync jobs, writes, cache invalidation, or provider payload passthrough. */
export async function listMarketplaceLive(platform: MarketplacePlatform, user: { id: string; role: string | null }, resource: LiveResource, query: LiveQuery): Promise<LiveListResult> {
  if (!platformSet.has(platform)) throw new MarketplaceLiveNotFoundError("Not found");
  const ownerIds = await marketplaceOwnerIds(user);
  return adapters[platform][resource](query, ownerIds);
}
