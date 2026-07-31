import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { getSessionFromRequest } from "@/utils/auth";
import { defaultRateLimits, withRateLimit } from "@/lib/api/rate-limit";
import { legacyFinancialReady, legacyKnownNumber, legacyOperationalNumber, legacyOperationalSum, legacySum } from "./legacy-quality";
import type { MarketplacePlatform } from "./types";

type LegacyStats = {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number | null;
  averageOrderValue: number | null;
  ordersByStatus: Record<string, number>;
  topProducts: Array<{ name: string; revenue: number | null; quantity: number | null }>;
  lastSyncedAt: Date | null;
  dateFrom: string | null;
  dateTo: string | null;
};

function dateRange(searchParams: URLSearchParams) {
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const value: Record<string, Date> = {};
  if (dateFrom) value.gte = new Date(dateFrom);
  if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); value.lte = to; }
  return { dateFrom, dateTo, value, hasDateFilter: Object.keys(value).length > 0 };
}

function emptyStats(dateFrom: string | null, dateTo: string | null): LegacyStats {
  return { totalProducts: 0, totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, ordersByStatus: {}, topProducts: [], lastSyncedAt: null, dateFrom, dateTo };
}

function statusMap(rows: Array<{ orderStatus: string; _count: number }>) {
  return Object.fromEntries(rows.map((row) => [row.orderStatus, row._count]));
}

async function lazadaStats(ownerIds: string[], searchParams: URLSearchParams, strictFinancials = true): Promise<LegacyStats> {
  const { dateFrom, dateTo, value, hasDateFilter } = dateRange(searchParams);
  const sellerId = searchParams.get("sellerId");
  const shops = await prisma.lazadaShop.findMany({ where: { userId: { in: ownerIds }, ...(sellerId ? { sellerId } : {}) }, select: { id: true } });
  const shopIds = shops.map((shop) => shop.id);
  if (!shopIds.length) return emptyStats(dateFrom, dateTo);
  const orderWhere = { shopId: { in: shopIds }, ...(hasDateFilter ? { lazadaCreatedAt: value } : {}) };
  const itemWhere = { order: { shopId: { in: shopIds }, ...(hasDateFilter ? { lazadaCreatedAt: value } : {}) } };
  const [totalProducts, totalOrders, statuses, totals, financialRows, items, lastShop] = await Promise.all([
    prisma.lazadaProduct.count({ where: { shopId: { in: shopIds } } }),
    prisma.lazadaOrder.count({ where: orderWhere }),
    prisma.lazadaOrder.groupBy({ by: ["orderStatus"], where: orderWhere, _count: true }),
    prisma.lazadaOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _avg: { totalAmount: true } }),
    prisma.lazadaOrder.findMany({ where: orderWhere, select: { totalAmount: true, financialQuality: true } }),
    prisma.lazadaOrderItem.findMany({ where: itemWhere, select: { productName: true, price: true, quantity: true, financialQuality: true } }),
    prisma.lazadaShop.findFirst({ where: { id: { in: shopIds } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
  ]);
  const ready = await legacyFinancialReady("lazada", shopIds);
  const knownNumber = strictFinancials ? (value: unknown, row: { financialQuality?: string | null }) => legacyKnownNumber(value, row, ready) : (value: unknown) => legacyOperationalNumber(value);
  const products = new Map<string, LegacySales>();
  for (const item of items) addLegacySale(products, item.productName, item.quantity, knownNumber(item.price, item) === null || knownNumber(item.quantity, item) === null ? null : item.price! * item.quantity!, item, ready, strictFinancials);
  const totalRevenue = strictFinancials ? legacySum(financialRows.map((row) => ({ ...row, value: row.totalAmount })), ready) : legacyOperationalSum(financialRows.map((row) => ({ value: row.totalAmount })));
  return { totalProducts, totalOrders, totalRevenue, averageOrderValue: totalRevenue === null ? null : totalOrders ? totalRevenue / totalOrders : 0, ordersByStatus: statusMap(statuses), topProducts: [...products].map(([name, value]) => ({ name, ...value })).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity)).slice(0, 10), lastSyncedAt: lastShop?.lastSyncedAt || null, dateFrom, dateTo };
}

async function shopeeStats(ownerIds: string[], searchParams: URLSearchParams, strictFinancials = true): Promise<LegacyStats> {
  const { dateFrom, dateTo, value, hasDateFilter } = dateRange(searchParams);
  const shopId = searchParams.get("shopId");
  const shops = await prisma.shopeeShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? { shopId: Number(shopId) } : {}) }, select: { id: true } });
  const shopIds = shops.map((shop) => shop.id);
  if (!shopIds.length) return emptyStats(dateFrom, dateTo);
  const orderWhere = { shopId: { in: shopIds }, ...(hasDateFilter ? { shopeeCreatedAt: value } : {}) };
  const itemWhere = { order: { shopId: { in: shopIds }, ...(hasDateFilter ? { shopeeCreatedAt: value } : {}) } };
  const [totalProducts, totalOrders, statuses, totals, financialRows, products, lastShop] = await Promise.all([
    prisma.shopeeProduct.count({ where: { shopId: { in: shopIds } } }),
    prisma.shopeeOrder.count({ where: orderWhere }),
    prisma.shopeeOrder.groupBy({ by: ["orderStatus"], where: orderWhere, _count: true }),
    prisma.shopeeOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _avg: { totalAmount: true } }),
    prisma.shopeeOrder.findMany({ where: orderWhere, select: { totalAmount: true, financialQuality: true } }),
    prisma.shopeeOrderItem.groupBy({ by: ["productName"], where: itemWhere, _sum: { subtotal: true, quantity: true }, orderBy: { _sum: { subtotal: "desc" } }, take: 10 }),
    prisma.shopeeShop.findFirst({ where: { id: { in: shopIds } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
  ]);
  const ready = await legacyFinancialReady("shopee", shopIds);
  const totalRevenue = strictFinancials ? legacySum(financialRows.map((row) => ({ ...row, value: row.totalAmount })), ready) : legacyOperationalSum(financialRows.map((row) => ({ value: row.totalAmount })));
  const productReady = strictFinancials ? ready && financialRows.every((row) => legacyKnownNumber(row.totalAmount, row, ready) !== null) : true;
  return { totalProducts, totalOrders, totalRevenue, averageOrderValue: totalRevenue === null ? null : totalOrders ? totalRevenue / totalOrders : 0, ordersByStatus: statusMap(statuses), topProducts: products.map((item) => ({ name: item.productName, revenue: productReady && typeof item._sum.subtotal === "number" ? item._sum.subtotal : null, quantity: productReady && typeof item._sum.quantity === "number" ? item._sum.quantity : null })), lastSyncedAt: lastShop?.lastSyncedAt || null, dateFrom, dateTo };
}

async function tiktokStats(ownerIds: string[], searchParams: URLSearchParams, strictFinancials = true): Promise<LegacyStats> {
  const { dateFrom, dateTo, value, hasDateFilter } = dateRange(searchParams);
  const shopId = searchParams.get("shopId");
  const shops = await prisma.tikTokShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? { shopId } : {}) }, select: { id: true } });
  const shopIds = shops.map((shop) => shop.id);
  if (!shopIds.length) return emptyStats(dateFrom, dateTo);
  const orderWhere = { shopId: { in: shopIds }, ...(hasDateFilter ? { tiktokCreatedAt: value } : {}) };
  const itemWhere = { order: { shopId: { in: shopIds }, ...(hasDateFilter ? { tiktokCreatedAt: value } : {}) } };
  const [totalProducts, totalOrders, statuses, totals, financialRows, items, lastShop] = await Promise.all([
    prisma.tikTokProduct.count({ where: { shopId: { in: shopIds } } }),
    prisma.tikTokOrder.count({ where: orderWhere }),
    prisma.tikTokOrder.groupBy({ by: ["orderStatus"], where: orderWhere, _count: true }),
    prisma.tikTokOrderItem.aggregate({ where: itemWhere, _sum: { subtotalAmount: true } }),
    prisma.tikTokOrderItem.findMany({ where: itemWhere, select: { subtotalAmount: true, financialQuality: true } }),
    prisma.tikTokOrderItem.findMany({ where: itemWhere, select: { productName: true, quantity: true, subtotalAmount: true, financialQuality: true } }),
    prisma.tikTokShop.findFirst({ where: { id: { in: shopIds } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
  ]);
  const ready = await legacyFinancialReady("tiktok", shopIds);
  const products = new Map<string, LegacySales>();
  for (const item of items) addLegacySale(products, item.productName, item.quantity, item.subtotalAmount, item, ready, strictFinancials);
  const totalRevenue = strictFinancials ? legacySum(financialRows.map((row) => ({ ...row, value: row.subtotalAmount })), ready) : legacyOperationalSum(financialRows.map((row) => ({ value: row.subtotalAmount })));
  return { totalProducts, totalOrders, totalRevenue, averageOrderValue: totalRevenue === null ? null : totalOrders ? totalRevenue / totalOrders : 0, ordersByStatus: statusMap(statuses), topProducts: [...products].map(([name, value]) => ({ name, ...value })).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity)).slice(0, 10), lastSyncedAt: lastShop?.lastSyncedAt || null, dateFrom, dateTo };
}

export async function shopifyStats(ownerIds: string[], searchParams: URLSearchParams, strictFinancials = true): Promise<LegacyStats> {
  const { dateFrom, dateTo, value, hasDateFilter } = dateRange(searchParams);
  const shopId = searchParams.get("shopId");
  const shops = await prisma.shopifyShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? { id: shopId } : {}) }, select: { id: true } });
  const shopIds = shops.map((shop) => shop.id);
  if (!shopIds.length) return emptyStats(dateFrom, dateTo);
  const orderWhere = { shopId: { in: shopIds }, ...(hasDateFilter ? { shopifyCreatedAt: value } : {}) };
  const itemWhere = { order: { shopId: { in: shopIds }, ...(hasDateFilter ? { shopifyCreatedAt: value } : {}) } };
  const [totalProducts, totalOrders, statuses, totals, financialRows, items, lastShop] = await Promise.all([
    prisma.shopifyProduct.count({ where: { shopId: { in: shopIds } } }),
    prisma.shopifyOrder.count({ where: orderWhere }),
    prisma.shopifyOrder.groupBy({ by: ["orderStatus"], where: orderWhere, _count: true }),
    prisma.shopifyOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _avg: { totalAmount: true } }),
    prisma.shopifyOrder.findMany({ where: orderWhere, select: { totalAmount: true, financialQuality: true } }),
    prisma.shopifyOrderItem.findMany({ where: itemWhere, select: { name: true, price: true, quantity: true, order: { select: { financialQuality: true } } } }),
    prisma.shopifyShop.findFirst({ where: { id: { in: shopIds } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
  ]);
  const ready = await legacyFinancialReady("shopify", shopIds);
  const knownNumber = strictFinancials ? (value: unknown, row: { financialQuality?: string | null }) => legacyKnownNumber(value, row, ready) : (value: unknown) => legacyOperationalNumber(value);
  const products = new Map<string, LegacySales>();
  for (const item of items) {
    const price = knownNumber(item.price, item.order);
    const quantity = knownNumber(item.quantity, item.order);
    addLegacySale(products, item.name, item.quantity, price === null || quantity === null ? null : price * quantity, item.order, ready, strictFinancials);
  }
  const totalRevenue = strictFinancials ? legacySum(financialRows.map((row) => ({ ...row, value: row.totalAmount })), ready) : legacyOperationalSum(financialRows.map((row) => ({ value: row.totalAmount })));
  return { totalProducts, totalOrders, totalRevenue, averageOrderValue: totalRevenue === null ? null : totalOrders ? totalRevenue / totalOrders : 0, ordersByStatus: statusMap(statuses), topProducts: [...products].map(([name, value]) => ({ name, ...value })).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity)).slice(0, 10), lastSyncedAt: lastShop?.lastSyncedAt || null, dateFrom, dateTo };
}

/** The unversioned static stats paths retain their pre-v1 response contract. */
export async function legacyMarketplaceStatsResponse(request: NextRequest, platform: MarketplacePlatform) {
  try {
    const limited = await withRateLimit(request, defaultRateLimits.standard);
    if (limited) return limited;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ownerIds = await marketplaceOwnerIds(session);
    const stats = platform === "lazada" ? await lazadaStats(ownerIds, request.nextUrl.searchParams, false) : platform === "shopee" ? await shopeeStats(ownerIds, request.nextUrl.searchParams, false) : platform === "tiktok" ? await tiktokStats(ownerIds, request.nextUrl.searchParams, false) : await shopifyStats(ownerIds, request.nextUrl.searchParams, false);
    return NextResponse.json(stats, { headers: { Deprecation: "true", Link: "</api/[platform]/stats?apiVersion=2026-analytics-v1>; rel=successor-version", "x-marketplace-analytics-contract": "legacy" } });
  } catch {
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}

type LegacyProduct = { id: string; itemName: string; stock: number; imageUrl: string | null; status: string; price?: number; identifier: Record<string, string | number> };
type LegacySales = { quantity: number | null; revenue: number | null };

function addLegacySale(sales: Map<string, LegacySales>, name: string, quantity: unknown, revenue: unknown, row: { financialQuality?: string | null }, ready: boolean, strictFinancials = true) {
  const available = !strictFinancials || ready;
  const value = sales.get(name) ?? { quantity: available ? 0 : null, revenue: available ? 0 : null };
  const knownQuantity = strictFinancials ? legacyKnownNumber(quantity, row, ready) : legacyOperationalNumber(quantity);
  const knownRevenue = strictFinancials ? legacyKnownNumber(revenue, row, ready) : legacyOperationalNumber(revenue);
  value.quantity = value.quantity !== null && knownQuantity !== null ? value.quantity + knownQuantity : null;
  value.revenue = value.revenue !== null && knownRevenue !== null ? value.revenue + knownRevenue : null;
  sales.set(name, value);
}

function productPerformance(products: LegacyProduct[], sales: Map<string, LegacySales>, lowStockThreshold: number, ready: boolean) {
  const values = products.map((product) => {
    const velocity = sales.get(product.itemName) ?? { quantity: ready ? 0 : null, revenue: ready ? 0 : null };
    const dailySalesRate = velocity.quantity === null ? null : velocity.quantity / 30;
    const daysUntilStockout = dailySalesRate === null ? null : dailySalesRate > 0 ? Math.round(product.stock / dailySalesRate) : product.stock === 0 ? 0 : null;
    const stockTurnover = velocity.quantity !== null && product.stock > 0 ? Math.round((velocity.quantity / product.stock) * 100) / 100 : null;
    const performanceRating = velocity.quantity === null ? "unavailable" : velocity.quantity >= 20 ? "excellent" : velocity.quantity >= 10 ? "good" : velocity.quantity >= 3 ? "average" : velocity.quantity > 0 ? "slow" : "dead";
    return { id: product.id, ...product.identifier, itemName: product.itemName, ...(product.price === undefined ? {} : { price: product.price }), stock: product.stock, imageUrl: product.imageUrl, status: product.status, quantitySold30d: velocity.quantity, revenue30d: velocity.revenue, dailySalesRate: dailySalesRate === null ? null : Math.round(dailySalesRate * 100) / 100, daysUntilStockout, stockTurnover, isSlowMoving: velocity.quantity === null ? null : velocity.quantity < 3 && product.stock > 0, isOutOfStock: product.stock === 0, isLowStock: product.stock > 0 && product.stock < lowStockThreshold, performanceRating };
  }).sort((a, b) => (b.revenue30d ?? -Infinity) - (a.revenue30d ?? -Infinity));
  return { products: values, summary: { totalProducts: values.length, lowStock: values.filter((product) => product.isLowStock).length, outOfStock: values.filter((product) => product.isOutOfStock).length, slowMoving: ready ? values.filter((product) => product.isSlowMoving).length : null, excellentPerformers: ready ? values.filter((product) => product.performanceRating === "excellent").length : null, goodPerformers: ready ? values.filter((product) => product.performanceRating === "good").length : null }, lowStockThreshold };
}

async function legacyShopIds(platform: MarketplacePlatform, ownerIds: string[], params: URLSearchParams, productMetric = false) {
  const shopId = params.get("shopId");
  if (platform === "shopee") return (await prisma.shopeeShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? { shopId: Number(shopId) } : {}) }, select: { id: true } })).map((shop) => shop.id);
  if (platform === "lazada") return (await prisma.lazadaShop.findMany({ where: { userId: { in: ownerIds }, ...(productMetric ? (shopId ? { id: shopId } : {}) : (params.get("sellerId") ? { sellerId: params.get("sellerId")! } : {})) }, select: { id: true } })).map((shop) => shop.id);
  if (platform === "tiktok") return (await prisma.tikTokShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? (productMetric ? { id: shopId } : { shopId }) : {}) }, select: { id: true } })).map((shop) => shop.id);
  return (await prisma.shopifyShop.findMany({ where: { userId: { in: ownerIds }, ...(shopId ? { id: shopId } : {}) }, select: { id: true } })).map((shop) => shop.id);
}

function legacyTrendResult(rows: Array<{ createdAt: Date | null; total: number | null; financialQuality?: string | null; id?: string }>, granularity: string, ready: boolean, strictFinancials = true) {
  const grouped = new Map<string, { revenue: number | null; orders: number }>();
  const countedOrders = new Set<string>();
  for (const row of rows) {
    if (!row.createdAt) continue;
    const date = new Date(row.createdAt);
    const period = granularity === "weekly" ? `${date.getFullYear()}-W${String(Math.ceil(((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86_400_000 + new Date(date.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, "0")}` : granularity === "monthly" ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : date.toISOString().slice(0, 10);
    const available = !strictFinancials || ready;
    const value = grouped.get(period) ?? { revenue: available ? 0 : null, orders: 0 };
    const total = strictFinancials ? legacyKnownNumber(row.total, row, ready) : legacyOperationalNumber(row.total);
    value.revenue = value.revenue !== null && total !== null ? value.revenue + total : null;
    const orderKey = row.id ? `${period}:${row.id}` : "";
    if (!orderKey || !countedOrders.has(orderKey)) value.orders++;
    if (orderKey) countedOrders.add(orderKey);
    grouped.set(period, value);
  }
  return { data: [...grouped].map(([period, value]) => ({ period, ...value })).sort((a, b) => a.period.localeCompare(b.period)), granularity };
}

async function legacyRevenueTrend(platform: MarketplacePlatform, ownerIds: string[], params: URLSearchParams, strictFinancials = true) {
  const shopIds = await legacyShopIds(platform, ownerIds, params);
  const granularity = params.get("granularity") || "daily";
  if (!shopIds.length) return { data: [], granularity };
  const ready = await legacyFinancialReady(platform, shopIds);
  const from = params.get("dateFrom") ? new Date(params.get("dateFrom")!) : new Date(Date.now() - 90 * 86_400_000);
  const to = params.get("dateTo") ? new Date(params.get("dateTo")!) : undefined;
  if (to) to.setHours(23, 59, 59, 999);
  if (platform === "shopee") return legacyTrendResult((await prisma.shopeeOrder.findMany({ where: { shopId: { in: shopIds }, orderStatus: { not: "CANCELLED" }, shopeeCreatedAt: { gte: from, ...(to ? { lte: to } : {}) } }, select: { shopeeCreatedAt: true, totalAmount: true, financialQuality: true } })).map((row) => ({ createdAt: row.shopeeCreatedAt, total: row.totalAmount, financialQuality: row.financialQuality })), granularity, ready, strictFinancials);
  if (platform === "lazada") return legacyTrendResult((await prisma.lazadaOrder.findMany({ where: { shopId: { in: shopIds }, orderStatus: { not: "cancelled" }, lazadaCreatedAt: { gte: from, ...(to ? { lte: to } : {}) } }, select: { lazadaCreatedAt: true, totalAmount: true, financialQuality: true } })).map((row) => ({ createdAt: row.lazadaCreatedAt, total: row.totalAmount, financialQuality: row.financialQuality })), granularity, ready, strictFinancials);
  if (platform === "tiktok") return legacyTrendResult((await prisma.tikTokOrderItem.findMany({ where: { order: { shopId: { in: shopIds }, orderStatus: { not: "CANCELLED" }, tiktokCreatedAt: { gte: from, ...(to ? { lte: to } : {}) } } }, select: { orderId: true, subtotalAmount: true, financialQuality: true, order: { select: { tiktokCreatedAt: true } } } })).map((item) => ({ id: item.orderId, createdAt: item.order.tiktokCreatedAt, total: item.subtotalAmount, financialQuality: item.financialQuality })), granularity, ready, strictFinancials);
  return legacyTrendResult((await prisma.shopifyOrder.findMany({ where: { shopId: { in: shopIds }, orderStatus: { not: "cancelled" }, shopifyCreatedAt: { gte: from, ...(to ? { lte: to } : {}) } }, select: { shopifyCreatedAt: true, totalAmount: true, financialQuality: true } })).map((row) => ({ createdAt: row.shopifyCreatedAt, total: row.totalAmount, financialQuality: row.financialQuality })), granularity, ready, strictFinancials);
}

async function legacyProducts(platform: MarketplacePlatform, ownerIds: string[], params: URLSearchParams, strictFinancials = true) {
  const shopIds = await legacyShopIds(platform, ownerIds, params, true);
  const ready = await legacyFinancialReady(platform, shopIds);
  if (platform === "shopee") {
    const shops = await prisma.shopeeShop.findMany({ where: { id: { in: shopIds } }, select: { lowStockThreshold: true } });
    const [products, items] = await Promise.all([prisma.shopeeProduct.findMany({ where: { shopId: { in: shopIds } }, select: { id: true, shopeeItemId: true, itemName: true, price: true, stock: true, imageUrl: true, status: true } }), prisma.shopeeOrderItem.findMany({ where: { order: { shopId: { in: shopIds }, shopeeCreatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, orderStatus: { not: "CANCELLED" } } }, select: { productName: true, quantity: true, subtotal: true, order: { select: { financialQuality: true } } } })]);
    const sales = new Map<string, LegacySales>(); for (const item of items) addLegacySale(sales, item.productName, item.quantity, item.subtotal, item.order, ready, strictFinancials);
    return productPerformance(products.map((product) => ({ id: product.id, itemName: product.itemName, stock: product.stock, imageUrl: product.imageUrl, status: product.status, price: product.price, identifier: { shopeeItemId: product.shopeeItemId } })), sales, Math.min(...shops.map((shop) => shop.lowStockThreshold), 10), !strictFinancials || ready);
  }
  if (platform === "lazada") {
    const shops = await prisma.lazadaShop.findMany({ where: { id: { in: shopIds } }, select: { lowStockThreshold: true } });
    const [products, items] = await Promise.all([prisma.lazadaProduct.findMany({ where: { shopId: { in: shopIds } }, select: { id: true, lazadaItemId: true, itemName: true, price: true, stock: true, imageUrl: true, status: true } }), prisma.lazadaOrderItem.findMany({ where: { order: { shopId: { in: shopIds }, lazadaCreatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, orderStatus: { not: "CANCELLED" } } }, select: { productName: true, quantity: true, price: true, financialQuality: true } })]);
    const sales = new Map<string, LegacySales>(); for (const item of items) addLegacySale(sales, item.productName, item.quantity, item.price === null || item.quantity === null ? null : item.price * item.quantity, item, ready, strictFinancials);
    return productPerformance(products.map((product) => ({ id: product.id, itemName: product.itemName, stock: product.stock, imageUrl: product.imageUrl, status: product.status, price: product.price, identifier: { lazadaItemId: product.lazadaItemId } })), sales, Math.min(...shops.map((shop) => shop.lowStockThreshold), 10), !strictFinancials || ready);
  }
  if (platform === "tiktok") {
    const shops = await prisma.tikTokShop.findMany({ where: { id: { in: shopIds } }, select: { lowStockThreshold: true } });
    const [products, items] = await Promise.all([prisma.tikTokProduct.findMany({ where: { shopId: { in: shopIds } }, select: { id: true, tiktokProductId: true, title: true, mainImageUrl: true, status: true, variants: { select: { totalQuantity: true } } } }), prisma.tikTokOrderItem.findMany({ where: { order: { shopId: { in: shopIds }, tiktokCreatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, orderStatus: { not: "CANCELLED" } } }, select: { productName: true, quantity: true, subtotalAmount: true, financialQuality: true } })]);
    const sales = new Map<string, LegacySales>(); for (const item of items) addLegacySale(sales, item.productName, item.quantity, item.subtotalAmount, item, ready, strictFinancials);
    return productPerformance(products.map((product) => ({ id: product.id, itemName: product.title, stock: product.variants.reduce((sum, variant) => sum + variant.totalQuantity, 0), imageUrl: product.mainImageUrl, status: product.status, identifier: { channelItemId: product.tiktokProductId } })), sales, Math.min(...shops.map((shop) => shop.lowStockThreshold), 10), !strictFinancials || ready);
  }
  const shops = await prisma.shopifyShop.findMany({ where: { id: { in: shopIds } }, select: { lowStockThreshold: true } });
  const [products, items] = await Promise.all([prisma.shopifyProduct.findMany({ where: { shopId: { in: shopIds } }, select: { id: true, shopifyProductId: true, title: true, totalInventory: true, featuredImageUrl: true, status: true } }), prisma.shopifyOrderItem.findMany({ where: { order: { shopId: { in: shopIds }, shopifyCreatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, orderStatus: { not: "CANCELLED" } } }, select: { name: true, quantity: true, price: true, discountedPrice: true, order: { select: { financialQuality: true } } } })]);
  const sales = new Map<string, LegacySales>();
  for (const item of items) {
    const price = strictFinancials ? legacyKnownNumber(item.discountedPrice ?? item.price, item.order, ready) : legacyOperationalNumber(item.discountedPrice ?? item.price);
    const quantity = strictFinancials ? legacyKnownNumber(item.quantity, item.order, ready) : legacyOperationalNumber(item.quantity);
    addLegacySale(sales, item.name, item.quantity, price === null || quantity === null ? null : price * quantity, item.order, ready, strictFinancials);
  }
  return productPerformance(products.map((product) => ({ id: product.id, itemName: product.title, stock: product.totalInventory, imageUrl: product.featuredImageUrl, status: product.status, identifier: { channelItemId: product.shopifyProductId } })), sales, Math.min(...shops.map((shop) => shop.lowStockThreshold), 10), !strictFinancials || ready);
}

function emptyShopeeBuyers() { return { totalBuyers: 0, repeatBuyers: 0, repeatRate: 0, avgOrdersPerBuyer: 0, topBuyers: [], geographicDistribution: [], spendingTiers: [] }; }

async function legacyBuyers(ownerIds: string[], params: URLSearchParams, strictFinancials = true) {
  const shopIds = await legacyShopIds("shopee", ownerIds, params);
  if (!shopIds.length) return emptyShopeeBuyers();
  const ready = await legacyFinancialReady("shopee", shopIds);
  const orders = await prisma.shopeeOrder.findMany({ where: { shopId: { in: shopIds }, buyerUsername: { not: "" } }, select: { buyerUsername: true, totalAmount: true, financialQuality: true } });
  const buyerRows = new Map<string, Array<{ value: number; financialQuality: string | null }>>();
  for (const order of orders) { const buyer = buyerRows.get(order.buyerUsername!) ?? []; buyer.push({ value: order.totalAmount, financialQuality: order.financialQuality }); buyerRows.set(order.buyerUsername!, buyer); }
  const buyers = [...buyerRows].map(([username, rows]) => ({ username, totalSpent: strictFinancials ? legacySum(rows, ready) : legacyOperationalSum(rows), orderCount: rows.length })).sort((a, b) => (b.totalSpent ?? -Infinity) - (a.totalSpent ?? -Infinity));
  const totalBuyers = buyers.length; const repeatBuyers = buyers.filter((buyer) => buyer.orderCount >= 2).length;
  const tiers = { under50: 0, "50to200": 0, "200to500": 0, over500: 0 };
  for (const buyer of buyers) { if (buyer.totalSpent === null) continue; if (buyer.totalSpent < 50) tiers.under50++; else if (buyer.totalSpent < 200) tiers["50to200"]++; else if (buyer.totalSpent < 500) tiers["200to500"]++; else tiers.over500++; }
  const addresses = await prisma.shopeeOrder.findMany({ where: { shopId: { in: shopIds }, shippingAddress: { not: null } }, select: { shippingAddress: true, region: true } });
  const countryNames: Record<string, string> = { SG: "Singapore", MY: "Malaysia", ID: "Indonesia", TH: "Thailand", PH: "Philippines", VN: "Vietnam", TW: "Taiwan", BR: "Brazil", MX: "Mexico", CL: "Chile", CO: "Colombia", PL: "Poland" };
  const regions = new Map<string, number>(); for (const order of addresses) { const address = order.shippingAddress as Record<string, unknown> | null; const masked = ["****", "*"].includes(String(address?.district ?? "")) && ["****", "*"].includes(String(address?.state ?? "")); const state = String(address?.state ?? "").trim(), city = String(address?.city ?? "").trim(); const region = !masked && state && state !== "****" ? state : !masked && city && city !== "****" ? city : order.region ? countryNames[order.region] ?? order.region : "Unknown"; regions.set(region, (regions.get(region) ?? 0) + 1); }
  const buyerValuesAvailable = buyers.every((buyer) => buyer.totalSpent !== null);
  return { totalBuyers, repeatBuyers, repeatRate: totalBuyers ? Math.round(repeatBuyers / totalBuyers * 10_000) / 100 : 0, avgOrdersPerBuyer: totalBuyers ? Math.round(buyers.reduce((sum, buyer) => sum + buyer.orderCount, 0) / totalBuyers * 100) / 100 : 0, topBuyers: buyers.slice(0, 10).map((buyer) => ({ username: buyer.username, totalSpent: buyer.totalSpent, orderCount: buyer.orderCount })), geographicDistribution: [...regions].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count).slice(0, 10), spendingTiers: buyerValuesAvailable ? [{ tier: "Under $50", count: tiers.under50 }, { tier: "$50 - $200", count: tiers["50to200"] }, { tier: "$200 - $500", count: tiers["200to500"] }, { tier: "Over $500", count: tiers.over500 }] : [] };
}

async function legacyProfit(ownerIds: string[], params: URLSearchParams) {
  const shopIds = await legacyShopIds("shopee", ownerIds, params);
  const ready = await legacyFinancialReady("shopee", shopIds);
  const where = { shopId: { in: shopIds }, orderStatus: { not: "CANCELLED" } };
  const [orders, items] = await Promise.all([
    prisma.shopeeOrder.findMany({ where, select: { totalAmount: true, commissionFee: true, serviceFee: true, sellerTxnFee: true, shippingFee: true, sellerIncome: true, financialQuality: true } }),
    prisma.shopeeOrderItem.findMany({ where: { order: where }, select: { productName: true, subtotal: true, quantity: true, order: { select: { financialQuality: true } } } }),
  ]);
  const total = (field: "totalAmount" | "commissionFee" | "serviceFee" | "sellerTxnFee" | "shippingFee" | "sellerIncome") => legacySum(orders.map((order) => ({ financialQuality: order.financialQuality, value: order[field] })), ready);
  const revenue = total("totalAmount"), commission = total("commissionFee"), service = total("serviceFee"), transaction = total("sellerTxnFee"), shipping = total("shippingFee"), income = total("sellerIncome");
  const fees = [commission, service, transaction, shipping].every((value) => value !== null) ? commission! + service! + transaction! + shipping! : null;
  const percent = (value: number | null) => revenue !== null && revenue !== 0 && value !== null ? Math.round(value / revenue * 10_000) / 100 : null;
  const round = (value: number) => Math.round(value * 100) / 100;
  const products = new Map<string, { revenue: number | null; quantity: number | null; orderCount: number }>();
  for (const item of items) { const product = products.get(item.productName) ?? { revenue: ready ? 0 : null, quantity: ready ? 0 : null, orderCount: 0 }; const productRevenue = legacyKnownNumber(item.subtotal, item.order, ready), quantity = legacyKnownNumber(item.quantity, item.order, ready); product.revenue = product.revenue !== null && productRevenue !== null ? product.revenue + productRevenue : null; product.quantity = product.quantity !== null && quantity !== null ? product.quantity + quantity : null; product.orderCount++; products.set(item.productName, product); }
  return { summary: { totalRevenue: revenue === null ? null : round(revenue), totalCommission: commission === null ? null : round(commission), totalServiceFee: service === null ? null : round(service), totalSellerTxnFee: transaction === null ? null : round(transaction), totalShippingFee: shipping === null ? null : round(shipping), totalSellerIncome: income === null ? null : round(income), totalFees: fees === null ? null : round(fees), overallMargin: percent(income), totalOrders: orders.length, avgOrderValue: revenue === null ? null : orders.length ? round(revenue / orders.length) : 0, avgFeePerOrder: fees === null ? null : orders.length ? round(fees / orders.length) : 0 }, byProduct: [...products].map(([productName, item]) => { const allocated = revenue !== null && revenue !== 0 && fees !== null && item.revenue !== null ? fees * item.revenue / revenue : null, estimatedProfit = item.revenue !== null && allocated !== null ? item.revenue - allocated : null; return { productName, revenue: item.revenue, quantitySold: item.quantity, orderCount: item.orderCount, estimatedFees: allocated === null ? null : round(allocated), estimatedProfit: estimatedProfit === null ? null : round(estimatedProfit), margin: item.revenue !== null && item.revenue !== 0 && estimatedProfit !== null ? Math.round(estimatedProfit / item.revenue * 10_000) / 100 : null }; }).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity)), feeBreakdown: [{ name: "Commission Fee", amount: commission, percentage: percent(commission) }, { name: "Service Fee", amount: service, percentage: percent(service) }, { name: "Seller Transaction Fee", amount: transaction, percentage: percent(transaction) }, { name: "Shipping Fee", amount: shipping, percentage: percent(shipping) }] };
}

function legacyPercentile(values: number[], percentile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile / 100 * sorted.length) - 1)] ?? 0;
}

export async function legacyClv(ownerIds: string[], params: URLSearchParams, strictFinancials = true) {
  const shopIds = await legacyShopIds("shopee", ownerIds, params);
  const empty = { summary: { totalBuyers: 0, avgClv: 0, avgRecency: 0, avgFrequency: 0, avgMonetary: 0 }, segments: { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 }, churnRisk: { high: 0, medium: 0, low: 0 }, topBuyersByClv: [] };
  if (!shopIds.length) return empty;
  const [ready, rows] = await Promise.all([
    legacyFinancialReady("shopee", shopIds),
    prisma.shopeeOrder.findMany({ where: { shopId: { in: shopIds }, buyerUsername: { not: "" }, orderStatus: { not: "CANCELLED" } }, select: { buyerUsername: true, totalAmount: true, financialQuality: true, shopeeCreatedAt: true } }),
  ]);
  if (!rows.length) return empty;
  if (strictFinancials && !ready) return { ...empty, summary: { ...empty.summary, avgClv: null, avgMonetary: null } };
  const now = new Date();
  const buyerRows = new Map<string, { totalSpent: number; orderCount: number; first: Date; last: Date }>();
  for (const row of rows) {
    const totalAmount = strictFinancials ? legacyKnownNumber(row.totalAmount, row, ready) : legacyOperationalNumber(row.totalAmount);
    if (totalAmount === null) return { ...empty, summary: { ...empty.summary, avgClv: null, avgMonetary: null } };
    const username = row.buyerUsername!;
    const date = row.shopeeCreatedAt ?? now;
    const buyer = buyerRows.get(username) ?? { totalSpent: 0, orderCount: 0, first: date, last: date };
    buyer.totalSpent += totalAmount;
    buyer.orderCount++;
    if (date < buyer.first) buyer.first = date;
    if (date > buyer.last) buyer.last = date;
    buyerRows.set(username, buyer);
  }
  const buyers = [...buyerRows].map(([username, buyer]) => {
    const { totalSpent, orderCount, first, last } = buyer;
    const recencyDays = Math.max(0, Math.round((now.getTime() - last.getTime()) / 86_400_000));
    const lifetimeDays = Math.max(1, (last.getTime() - first.getTime()) / 86_400_000);
    const avgOrderValue = totalSpent / orderCount;
    const frequencyRate = lifetimeDays > 0 ? orderCount / lifetimeDays * 30 : orderCount;
    const clvEstimate = avgOrderValue * frequencyRate * 12 * (recencyDays < 90 ? 1 : recencyDays < 180 ? 0.7 : 0.4);
    return { username, totalSpent, orderCount, recencyDays, avgOrderValue: Math.round(avgOrderValue * 100) / 100, clvEstimate: Math.round(clvEstimate * 100) / 100 };
  });
  const recencyP50 = legacyPercentile(buyers.map((buyer) => buyer.recencyDays), 50), frequencyP50 = legacyPercentile(buyers.map((buyer) => buyer.orderCount), 50), monetaryP50 = legacyPercentile(buyers.map((buyer) => buyer.totalSpent), 50);
  const segments = { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 };
  const churnRisk = { high: 0, medium: 0, low: 0 };
  for (const buyer of buyers) { const recent = buyer.recencyDays <= recencyP50, frequent = buyer.orderCount >= frequencyP50, valuable = buyer.totalSpent >= monetaryP50; if (recent && frequent && valuable) segments.champions++; else if (recent && frequent) segments.loyal++; else if (recent && valuable) segments.potential++; else if (!recent && (frequent || valuable)) segments.atRisk++; else segments.lost++; if (buyer.recencyDays > 90) churnRisk.high++; else if (buyer.recencyDays > 60) churnRisk.medium++; else churnRisk.low++; }
  return { summary: { totalBuyers: buyers.length, avgClv: Math.round(buyers.reduce((sum, buyer) => sum + buyer.clvEstimate, 0) / buyers.length * 100) / 100, avgRecency: Math.round(buyers.reduce((sum, buyer) => sum + buyer.recencyDays, 0) / buyers.length), avgFrequency: Math.round(buyers.reduce((sum, buyer) => sum + buyer.orderCount, 0) / buyers.length * 100) / 100, avgMonetary: Math.round(buyers.reduce((sum, buyer) => sum + buyer.totalSpent, 0) / buyers.length * 100) / 100 }, segments, churnRisk, topBuyersByClv: [...buyers].sort((a, b) => b.clvEstimate - a.clvEstimate).slice(0, 10).map((buyer) => ({ username: buyer.username, clvEstimate: buyer.clvEstimate, orderCount: buyer.orderCount, avgOrderValue: buyer.avgOrderValue, recencyDays: buyer.recencyDays, totalSpent: buyer.totalSpent })) };
}

/** Compatibility adapter for the typed pre-v1 API client. Keep v1 validation isolated in server.ts. */
export async function legacyMarketplaceMetricResponse(request: NextRequest, platform: MarketplacePlatform, metric: string) {
  try {
    const limited = await withRateLimit(request, defaultRateLimits.standard);
    if (limited) return limited;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ownerIds = await marketplaceOwnerIds(session);
    const params = request.nextUrl.searchParams;
    const legacy = (body: unknown) => NextResponse.json(body, { headers: { Deprecation: "true", "x-marketplace-analytics-contract": "legacy" } });
    if (metric === "revenue-trend") return legacy(await legacyRevenueTrend(platform, ownerIds, params, false));
    if (metric === "products") return NextResponse.json(await legacyProducts(platform, ownerIds, params, false));
    if (platform === "shopee" && metric === "buyers") return NextResponse.json(await legacyBuyers(ownerIds, params, false));
    if (platform === "shopee" && metric === "clv") return NextResponse.json(await legacyClv(ownerIds, params, false));
    if (platform === "shopee" && metric === "profit") return NextResponse.json(await legacyProfit(ownerIds, params));
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: `Failed to fetch ${metric}` }, { status: 500 });
  }
}
