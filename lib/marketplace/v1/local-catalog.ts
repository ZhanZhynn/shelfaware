import { z } from "zod";
import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const platforms = new Set<MarketplacePlatform>(["shopee", "lazada", "tiktok", "shopify"]);
const objectId = /^[a-f\d]{24}$/i;

export class MarketplaceV1ValidationError extends Error {}
export class MarketplaceV1NotFoundError extends Error {}

type Resource = "orders" | "products";
type LocalQuery = { shopId?: string; status?: string; search?: string; createdAfter?: string; createdBefore?: string; limit: number; cursor?: string };

const common = {
  shopId: z.string().regex(objectId, "shopId must be an internal shop ID").optional(),
  status: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
};

const orderSchema = z.object({ ...common, createdAfter: z.string().datetime({ offset: true }).optional(), createdBefore: z.string().datetime({ offset: true }).optional() }).strict();
const productSchema = z.object({ ...common, search: z.string().trim().min(1).max(200).optional() }).strict();

function duplicateQueryKey(params: URLSearchParams) {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export function parseLocalQuery(params: URLSearchParams, resource: Resource): LocalQuery {
  const duplicate = duplicateQueryKey(params);
  if (duplicate) throw new MarketplaceV1ValidationError(`Duplicate query parameter: ${duplicate}`);
  const parsed = (resource === "orders" ? orderSchema : productSchema).safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new MarketplaceV1ValidationError("Invalid query parameters");
  const data = parsed.data as LocalQuery;
  if (resource === "orders" && data.createdAfter && data.createdBefore && new Date(data.createdAfter) > new Date(data.createdBefore)) {
    throw new MarketplaceV1ValidationError("createdAfter must not be after createdBefore");
  }
  return data;
}

function fingerprint(platform: MarketplacePlatform, resource: Resource, query: LocalQuery) {
  return JSON.stringify({ platform, resource, shopId: query.shopId ?? null, status: query.status ?? null, search: query.search ?? null, createdAfter: query.createdAfter ?? null, createdBefore: query.createdBefore ?? null });
}

export function encodeMarketplaceCursor(platform: MarketplacePlatform, resource: Resource, query: LocalQuery, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, platform, resource, filter: fingerprint(platform, resource, query), id })).toString("base64url");
}

export function decodeMarketplaceCursor(platform: MarketplacePlatform, resource: Resource, query: LocalQuery, cursor?: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value?.v !== 1 || value.platform !== platform || value.resource !== resource || value.filter !== fingerprint(platform, resource, query) || typeof value.id !== "string" || !objectId.test(value.id)) throw new Error();
    return value.id;
  } catch {
    throw new MarketplaceV1ValidationError("Invalid cursor");
  }
}

async function authorizeShop(platform: MarketplacePlatform, shopId: string | undefined, ownerIds: string[]) {
  if (!shopId) return undefined;
  const where = { id: shopId, userId: { in: ownerIds } };
  const shop = platform === "shopee"
    ? await prisma.shopeeShop.findFirst({ where, select: { id: true } })
    : platform === "lazada"
      ? await prisma.lazadaShop.findFirst({ where, select: { id: true } })
      : platform === "tiktok"
        ? await prisma.tikTokShop.findFirst({ where, select: { id: true } })
        : await prisma.shopifyShop.findFirst({ where, select: { id: true } });
  if (!shop) throw new MarketplaceV1NotFoundError("Shop not found");
  return shop.id;
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const page = <T extends { id: string }>(rows: T[], limit: number, platform: MarketplacePlatform, resource: Resource, query: LocalQuery) => {
  const data = rows.slice(0, limit);
  return { data, page: { limit, nextCursor: rows.length > limit && data.length ? encodeMarketplaceCursor(platform, resource, query, data[data.length - 1]!.id) : null } };
};

export async function listMarketplaceOrders(platform: MarketplacePlatform, user: { id: string; role: string | null }, query: LocalQuery) {
  if (!platforms.has(platform)) throw new MarketplaceV1NotFoundError("Not found");
  const ownerIds = await marketplaceOwnerIds(user);
  const shopId = await authorizeShop(platform, query.shopId, ownerIds);
  const cursor = decodeMarketplaceCursor(platform, "orders", query, query.cursor);
  const where: Record<string, unknown> = { userId: { in: ownerIds }, ...(shopId ? { shopId } : {}), ...(query.status ? { orderStatus: query.status } : {}), ...(query.createdAfter || query.createdBefore ? { createdAt: { ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}), ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}) } } : {}) };
  const options = { where, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: query.limit + 1 };

  if (platform === "shopee") {
    const rows = await prisma.shopeeOrder.findMany({ ...options, select: { id: true, shopId: true, shopeeOrderId: true, orderStatus: true, paymentStatus: true, totalAmount: true, currency: true, trackingNumber: true, trackingCarrier: true, createdAt: true, updatedAt: true, shopeeCreatedAt: true, shopeeUpdatedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.shopeeOrderId, status: row.orderStatus, paymentStatus: row.paymentStatus, totalAmount: row.totalAmount, currency: row.currency, tracking: { number: row.trackingNumber, carrier: row.trackingCarrier }, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), sourceCreatedAt: iso(row.shopeeCreatedAt), sourceUpdatedAt: iso(row.shopeeUpdatedAt) })), query.limit, platform, "orders", query);
  }
  if (platform === "lazada") {
    const rows = await prisma.lazadaOrder.findMany({ ...options, select: { id: true, shopId: true, lazadaOrderId: true, orderNumber: true, orderStatus: true, paymentStatus: true, totalAmount: true, shippingFee: true, currency: true, trackingNumber: true, trackingCarrier: true, createdAt: true, updatedAt: true, lazadaCreatedAt: true, lazadaUpdatedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.lazadaOrderId, reference: row.orderNumber, status: row.orderStatus, paymentStatus: row.paymentStatus, totalAmount: row.totalAmount, shippingAmount: row.shippingFee, currency: row.currency, tracking: { number: row.trackingNumber, carrier: row.trackingCarrier }, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), sourceCreatedAt: iso(row.lazadaCreatedAt), sourceUpdatedAt: iso(row.lazadaUpdatedAt) })), query.limit, platform, "orders", query);
  }
  if (platform === "tiktok") {
    const rows = await prisma.tikTokOrder.findMany({ ...options, select: { id: true, shopId: true, tiktokOrderId: true, orderStatus: true, trackingNumber: true, shippingProvider: true, fulfillmentType: true, shippingType: true, currency: true, createdAt: true, updatedAt: true, tiktokCreatedAt: true, tiktokUpdatedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.tiktokOrderId, status: row.orderStatus, totalAmount: null, currency: row.currency, fulfillmentStatus: row.fulfillmentType, shippingType: row.shippingType, tracking: { number: row.trackingNumber, carrier: row.shippingProvider }, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), sourceCreatedAt: iso(row.tiktokCreatedAt), sourceUpdatedAt: iso(row.tiktokUpdatedAt) })), query.limit, platform, "orders", query);
  }
  const rows = await prisma.shopifyOrder.findMany({ ...options, select: { id: true, shopId: true, shopifyOrderId: true, orderName: true, orderStatus: true, financialStatus: true, fulfillmentStatus: true, totalAmount: true, subtotalAmount: true, shippingAmount: true, taxAmount: true, currency: true, createdAt: true, updatedAt: true, shopifyCreatedAt: true, shopifyUpdatedAt: true } });
  return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.shopifyOrderId, reference: row.orderName, status: row.orderStatus, paymentStatus: row.financialStatus, fulfillmentStatus: row.fulfillmentStatus, totalAmount: row.totalAmount, subtotalAmount: row.subtotalAmount, shippingAmount: row.shippingAmount, taxAmount: row.taxAmount, currency: row.currency, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), sourceCreatedAt: iso(row.shopifyCreatedAt), sourceUpdatedAt: iso(row.shopifyUpdatedAt) })), query.limit, platform, "orders", query);
}

export async function listMarketplaceProducts(platform: MarketplacePlatform, user: { id: string; role: string | null }, query: LocalQuery) {
  if (!platforms.has(platform)) throw new MarketplaceV1NotFoundError("Not found");
  const ownerIds = await marketplaceOwnerIds(user);
  const shopId = await authorizeShop(platform, query.shopId, ownerIds);
  const cursor = decodeMarketplaceCursor(platform, "products", query, query.cursor);
  const where: Record<string, unknown> = { userId: { in: ownerIds }, ...(shopId ? { shopId } : {}), ...(query.status ? { status: query.status } : {}) };
  const options = { where, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: query.limit + 1 };

  if (platform === "shopee") {
    if (query.search) where.OR = [{ itemName: { contains: query.search, mode: "insensitive" } }, { itemSku: { contains: query.search, mode: "insensitive" } }];
    const rows = await prisma.shopeeProduct.findMany({ ...options, select: { id: true, shopId: true, shopeeItemId: true, itemName: true, itemSku: true, price: true, originalPrice: true, stock: true, imageUrl: true, status: true, createdAt: true, updatedAt: true, lastSyncedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: String(row.shopeeItemId), title: row.itemName, sku: row.itemSku, price: row.price, originalPrice: row.originalPrice, stock: row.stock, imageUrl: row.imageUrl, status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), lastSyncedAt: iso(row.lastSyncedAt) })), query.limit, platform, "products", query);
  }
  if (platform === "lazada") {
    if (query.search) where.OR = [{ itemName: { contains: query.search, mode: "insensitive" } }, { sellerSku: { contains: query.search, mode: "insensitive" } }];
    const rows = await prisma.lazadaProduct.findMany({ ...options, select: { id: true, shopId: true, lazadaItemId: true, itemName: true, sellerSku: true, price: true, specialPrice: true, stock: true, imageUrl: true, status: true, createdAt: true, updatedAt: true, lastSyncedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: String(row.lazadaItemId), title: row.itemName, sku: row.sellerSku, price: row.price, specialPrice: row.specialPrice, stock: row.stock, imageUrl: row.imageUrl, status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), lastSyncedAt: iso(row.lastSyncedAt) })), query.limit, platform, "products", query);
  }
  if (platform === "tiktok") {
    if (query.search) where.OR = [{ title: { contains: query.search, mode: "insensitive" } }, { tiktokProductId: { contains: query.search, mode: "insensitive" } }];
    const rows = await prisma.tikTokProduct.findMany({ ...options, select: { id: true, shopId: true, tiktokProductId: true, title: true, mainImageUrl: true, status: true, auditStatus: true, createdAt: true, updatedAt: true, lastSyncedAt: true } });
    return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.tiktokProductId, title: row.title, sku: null, price: null, stock: null, imageUrl: row.mainImageUrl, status: row.status, auditStatus: row.auditStatus, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), lastSyncedAt: iso(row.lastSyncedAt) })), query.limit, platform, "products", query);
  }
  if (query.search) where.OR = [{ title: { contains: query.search, mode: "insensitive" } }, { handle: { contains: query.search, mode: "insensitive" } }, { vendor: { contains: query.search, mode: "insensitive" } }];
  const rows = await prisma.shopifyProduct.findMany({ ...options, select: { id: true, shopId: true, shopifyProductId: true, title: true, handle: true, vendor: true, totalInventory: true, featuredImageUrl: true, status: true, createdAt: true, updatedAt: true, lastSyncedAt: true } });
  return page(rows.map((row) => ({ id: row.id, shopId: row.shopId, externalId: row.shopifyProductId, title: row.title, handle: row.handle, vendor: row.vendor, sku: null, price: null, stock: row.totalInventory, imageUrl: row.featuredImageUrl, status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), lastSyncedAt: iso(row.lastSyncedAt) })), query.limit, platform, "products", query);
}
