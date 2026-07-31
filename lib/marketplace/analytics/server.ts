import { prisma } from "@/prisma/client";
import { getCache, setCache } from "@/lib/cache/cache-utils";
import { marketplaceCacheScope, marketplaceOwnerIds } from "@/lib/marketplace/access";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { marketplaceAnalyticsCacheKey } from "./cache";
import { getMarketplaceCapabilities, getMarketplaceFinancialReadiness } from "./capabilities";
import { calculateBuyerMetrics, calculateClvMetrics, calculateProfit } from "./calculators";
import type { MarketplacePlatform, NormalizedOrderFinancials, OperationalCoverage } from "./types";
import type { CapabilityState } from "./capabilities";
import { createHmac } from "crypto";
import { marketplaceFinancialDisplayEligible } from "./rollout";

export const ANALYTICS_CALCULATION_VERSION = "v5-operational-catalog-sku";

export class AnalyticsValidationError extends Error {
  constructor(message: string, readonly code: "INVALID_QUERY" | "FORBIDDEN" | "MIXED_CURRENCY" | "CONVERSION_UNAVAILABLE" = "INVALID_QUERY") { super(message); }
}

const reportingCurrencies = new Set(["MYR", "SGD", "IDR", "THB", "PHP", "VND", "USD", "GBP", "EUR", "AUD", "CAD"]);
export type AnalyticsPage = { limit: number; cursor: string | null; nextCursor: string | null; total: number };

export function parseAnalyticsPagination(params: URLSearchParams) {
  const rawLimit = params.get("limit") ?? "50";
  if (!/^\d+$/.test(rawLimit)) throw new AnalyticsValidationError("limit must be an integer between 1 and 100");
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 100) throw new AnalyticsValidationError("limit must be an integer between 1 and 100");
  const cursor = params.get("cursor");
  let offset = 0;
  if (cursor) {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new AnalyticsValidationError("cursor is invalid");
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^offset:\d+$/.test(decoded)) throw new AnalyticsValidationError("cursor is invalid");
    offset = Number(decoded.slice(7));
    if (!Number.isSafeInteger(offset)) throw new AnalyticsValidationError("cursor is invalid");
  }
  return { limit, cursor, offset };
}

export function paginateAnalyticsValues<T>(values: T[], pagination: ReturnType<typeof parseAnalyticsPagination>) {
  return {
    values: values.slice(pagination.offset, pagination.offset + pagination.limit),
    page: { limit: pagination.limit, cursor: pagination.cursor, nextCursor: pagination.offset + pagination.limit < values.length ? pageCursor(pagination.offset + pagination.limit) : null, total: values.length },
  };
}

function pageCursor(offset: number) { return Buffer.from(`offset:${offset}`).toString("base64url"); }

export function validateReportingCurrency(currency: string) {
  if (currency !== "native" && (!/^[A-Z]{3}$/.test(currency) || !reportingCurrencies.has(currency))) throw new AnalyticsValidationError("currency must be native or an allowed ISO 4217 currency");
  return currency;
}

/** Missing capability or reconciliation is deliberately not treated as ready. */
export function isFinancialAnalyticsReady(financeCapability: CapabilityState, reconciled: boolean) {
  return financeCapability === "available" && reconciled;
}

/** The sole server-side gate for any financial output. Client flags never participate. */
export function isFinancialAnalyticsEligible(input: { platform: MarketplacePlatform; shops: Array<{ id: string; region: string | null }>; finance: CapabilityState; readinessAndEvidenceApproved: boolean }) {
  return input.shops.length > 0 && isFinancialAnalyticsReady(input.finance, input.readinessAndEvidenceApproved) && input.shops.every((shop) => marketplaceFinancialDisplayEligible({ platform: input.platform, region: shop.region, shopId: shop.id, enabled: true, finance: input.finance, reconciliationApproved: input.readinessAndEvidenceApproved }));
}

function buyerPseudonym(shopId: string, identity: string | null): string | null {
  if (!identity) return null;
  const secret = process.env.MARKETPLACE_ANALYTICS_PSEUDONYM_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return "Buyer";
  return `Buyer ${createHmac("sha256", secret).update(`${shopId}:${identity}`).digest("hex").slice(0, 10)}`;
}

export function parseAnalyticsDateRange(params: URLSearchParams) {
  const from = params.get("dateFrom");
  const to = params.get("dateTo");
  const parse = (value: string, name: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AnalyticsValidationError(`${name} must be YYYY-MM-DD`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AnalyticsValidationError(`${name} is invalid`);
    return date;
  };
  const value: { gte?: Date; lte?: Date } = {};
  if (from) value.gte = parse(from, "dateFrom");
  if (to) { const end = parse(to, "dateTo"); end.setUTCHours(23, 59, 59, 999); value.lte = end; }
  if (value.gte && value.lte && value.gte > value.lte) throw new AnalyticsValidationError("dateFrom must not be after dateTo");
  return Object.keys(value).length ? value : undefined;
}

export function resolveReportingCurrency(orders: Pick<NormalizedOrderFinancials, "currency">[], requestedCurrency: string): string {
  const sourceCurrencies = [...new Set(orders.map((order) => order.currency))];
  if (sourceCurrencies.length > 1) throw new AnalyticsValidationError(`Cannot aggregate ${sourceCurrencies.join(", ")} without a verified currency conversion. Filter to one shop/currency.`, "MIXED_CURRENCY");
  if (requestedCurrency !== "native" && sourceCurrencies.length && requestedCurrency !== sourceCurrencies[0]) throw new AnalyticsValidationError(`Currency conversion from ${sourceCurrencies[0]} to ${requestedCurrency} is unavailable.`, "CONVERSION_UNAVAILABLE");
  return sourceCurrencies[0] ?? (requestedCurrency === "native" ? "unknown" : requestedCurrency);
}

function orderDate(row: { shopeeCreatedAt?: Date | null; lazadaCreatedAt?: Date | null; tiktokCreatedAt?: Date | null; shopifyCreatedAt?: Date | null; createdAt: Date }) {
  return row.shopeeCreatedAt ?? row.lazadaCreatedAt ?? row.tiktokCreatedAt ?? row.shopifyCreatedAt ?? row.createdAt;
}

type MarketplaceAnalyticsResult = ReturnType<typeof buildResponse> & {
  filters: { shopIds: string[]; dateFrom: string | null; dateTo: string | null; currency: string; granularity: string | null };
  capabilities: Awaited<ReturnType<typeof getMarketplaceCapabilities>>;
  page: AnalyticsPage | null;
  operationalCoverage: OperationalCoverage;
  financialCoverage: ReturnType<typeof buildResponse>["profit"]["coverage"];
};

export async function getMarketplaceAnalytics(platform: MarketplacePlatform, session: Parameters<typeof marketplaceOwnerIds>[0], params: URLSearchParams, metric = "summary"): Promise<MarketplaceAnalyticsResult> {
  const ownerIds = await marketplaceOwnerIds(session);
  const selectedShop = params.get("shopId");
  if (params.has("sellerId")) throw new AnalyticsValidationError("sellerId is not supported; use the internal shopId from /api/marketplace/shops");
  const accessibleShops = await accessibleMarketplaceShops(session, platform);
  const selectedShops = selectedShop ? accessibleShops.filter((shop) => shop.id === selectedShop) : accessibleShops;
  if (selectedShop && selectedShops.length === 0) throw new AnalyticsValidationError("Selected shop is unavailable", "FORBIDDEN");
  const currency = validateReportingCurrency(params.get("currency") ?? "native");
  const requestedGranularity = params.get("granularity") ?? "day";
  const granularity = requestedGranularity === "day" ? "daily" : requestedGranularity === "week" ? "weekly" : requestedGranularity === "month" ? "monthly" : null;
  if (!granularity) throw new AnalyticsValidationError("granularity must be day, week, or month");
  const pagination = parseAnalyticsPagination(params);
  const range = parseAnalyticsDateRange(params);
  const cacheKey = marketplaceAnalyticsCacheKey({ platform, accessScope: marketplaceCacheScope(session), shopIds: selectedShops.map((shop) => shop.id), metric, dateFrom: params.get("dateFrom") ?? "all", dateTo: params.get("dateTo") ?? "all", currency, granularity: requestedGranularity, cursor: pagination.cursor ?? "first", limit: pagination.limit });
  const cached = await getCache<MarketplaceAnalyticsResult>(cacheKey);
  if (cached) return cached;

  let orders: NormalizedOrderFinancials[] = [];
  let shopCount = 0;
  const fallbackDateFilter = (field: string) => range ? { OR: [{ [field]: range }, { [field]: null, createdAt: range }] } : {};
  if (platform === "shopee") {
    const shops = await prisma.shopeeShop.findMany({ where: { userId: { in: ownerIds }, id: { in: selectedShops.map((shop) => shop.id) } }, select: { id: true } });
    shopCount = shops.length;
    const rows = await prisma.shopeeOrder.findMany({ where: { shopId: { in: shops.map((shop) => shop.id) }, ...fallbackDateFilter("shopeeCreatedAt") }, include: { items: true } });
    orders = rows.map((row) => { const buyerId = row.buyerUsername ?? row.buyerEmail; return { id: row.id, shopId: row.shopId, platform, currency: row.currency ?? "unknown", createdAt: orderDate(row), status: row.orderStatus, buyerId, buyerDisplayName: buyerPseudonym(row.shopId, buyerId), financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"], grossSales: row.totalAmount, sellerDiscount: null, platformDiscount: null, refund: null, buyerShippingCredit: null, platformSubsidy: null, marketplaceFees: row.commissionFee === null || row.serviceFee === null ? null : row.commissionFee + row.serviceFee, paymentFees: row.sellerTxnFee, sellerShipping: row.shippingFee, returnShipping: null, otherCharges: null, settledProceeds: row.sellerIncome, settledProceedsVerified: false, items: row.items.map((item) => ({ id: item.id, productId: item.variantId ?? item.productId, productName: item.productName, sku: item.sku, imageUrl: null, quantity: item.quantity, grossSales: item.subtotal, refund: null, financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"] })) }; });
  } else if (platform === "lazada") {
    const shops = await prisma.lazadaShop.findMany({ where: { userId: { in: ownerIds }, id: { in: selectedShops.map((shop) => shop.id) } }, select: { id: true } });
    shopCount = shops.length;
    const [rows, products] = await Promise.all([
      prisma.lazadaOrder.findMany({ where: { shopId: { in: shops.map((shop) => shop.id) }, ...fallbackDateFilter("lazadaCreatedAt") }, include: { items: true } }),
      prisma.lazadaProduct.findMany({ where: { shopId: { in: shops.map((shop) => shop.id) } }, select: { shopId: true, lazadaItemId: true, sellerSku: true, itemName: true, imageUrl: true } }),
    ]);
    const productKey = (shopId: string, value: string | number) => `${shopId}:${String(value).trim().toLocaleLowerCase()}`;
    const imagesByItemId = new Map(products.map((product) => [productKey(product.shopId, product.lazadaItemId), product.imageUrl]));
    const skusByItemId = new Map(products.map((product) => [productKey(product.shopId, product.lazadaItemId), product.sellerSku]));
    const imagesBySku = new Map(products.filter((product) => product.sellerSku).map((product) => [productKey(product.shopId, product.sellerSku!), product.imageUrl]));
    const imagesByName = new Map<string, string | null>();
    const skusByName = new Map<string, string | null>();
    for (const product of products) {
      const key = productKey(product.shopId, product.itemName);
      const previous = imagesByName.get(key);
      const previousSku = skusByName.get(key);
      // Never guess when multiple catalog products share a name.
      imagesByName.set(key, previous === undefined ? product.imageUrl : previous === product.imageUrl ? previous : null);
      skusByName.set(key, previousSku === undefined ? product.sellerSku : previousSku === product.sellerSku ? previousSku : null);
    }
    orders = rows.map((row) => ({ id: row.id, shopId: row.shopId, platform, currency: row.currency ?? "unknown", createdAt: orderDate(row), status: row.orderStatus, buyerId: null, buyerDisplayName: null, financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"], grossSales: row.totalAmount, sellerDiscount: null, platformDiscount: null, refund: null, buyerShippingCredit: row.shippingFee, platformSubsidy: null, marketplaceFees: null, paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null, settledProceeds: null, settledProceedsVerified: false, items: row.items.map((item) => { const itemKey = item.itemId === null ? null : productKey(row.shopId, item.itemId); const nameKey = productKey(row.shopId, item.productName); const imageUrl = itemKey ? imagesByItemId.get(itemKey) ?? null : null; const sku = item.sellerSku ?? (itemKey ? skusByItemId.get(itemKey) ?? null : null) ?? skusByName.get(nameKey) ?? null; return { id: item.id, productId: item.skuId ?? sku, productName: item.productName, sku, imageUrl: imageUrl ?? (sku ? imagesBySku.get(productKey(row.shopId, sku)) ?? null : null) ?? imagesByName.get(nameKey) ?? null, quantity: item.quantity, grossSales: item.paidPrice ?? (item.price === null || item.quantity === null ? null : item.price * item.quantity), refund: null, financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"] }; }) }));
  } else if (platform === "tiktok") {
    const shops = await prisma.tikTokShop.findMany({ where: { userId: { in: ownerIds }, id: { in: selectedShops.map((shop) => shop.id) } }, select: { id: true } });
    shopCount = shops.length;
    const rows = await prisma.tikTokOrder.findMany({ where: { shopId: { in: shops.map((shop) => shop.id) }, ...fallbackDateFilter("tiktokCreatedAt") }, include: { items: true } });
    orders = rows.map((row) => { const buyerId = row.buyerUserId ?? row.buyerEmail; return { id: row.id, shopId: row.shopId, platform, currency: (row.payment as { currency?: string } | null)?.currency ?? row.currency ?? "unknown", createdAt: orderDate(row), status: row.orderStatus, buyerId, buyerDisplayName: buyerPseudonym(row.shopId, buyerId), financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"], grossSales: (row.payment as { total_product_price?: number } | null)?.total_product_price ?? null, sellerDiscount: null, platformDiscount: null, refund: null, buyerShippingCredit: null, platformSubsidy: null, marketplaceFees: null, paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null, settledProceeds: null, settledProceedsVerified: false, items: row.items.map((item) => ({ id: item.tiktokOrderLineItemId, productId: item.skuId ?? item.productId, productName: item.productName, sku: item.sellerSku, imageUrl: item.productImageUrl, quantity: item.quantity, grossSales: item.subtotalAmount ?? (item.price === null || item.quantity === null ? null : item.price * item.quantity), refund: item.refundAmount, financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"] })) }; });
  } else {
    const shops = await prisma.shopifyShop.findMany({ where: { userId: { in: ownerIds }, id: { in: selectedShops.map((shop) => shop.id) } }, select: { id: true } });
    shopCount = shops.length;
    const [rows, variants] = await Promise.all([
      prisma.shopifyOrder.findMany({ where: { shopId: { in: shops.map((shop) => shop.id) }, test: false, ...fallbackDateFilter("shopifyCreatedAt") }, include: { items: true } }),
      prisma.shopifyProductVariant.findMany({ where: { product: { shopId: { in: shops.map((shop) => shop.id) } } }, select: { id: true, product: { select: { featuredImageUrl: true } } } }),
    ]);
    const images = new Map(variants.map((variant) => [variant.id, variant.product.featuredImageUrl]));
    orders = rows.map((row) => { const buyerId = row.customerEmail; return { id: row.id, shopId: row.shopId, platform, currency: row.currency, createdAt: orderDate(row), status: row.orderStatus, buyerId, buyerDisplayName: buyerPseudonym(row.shopId, buyerId), financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"], grossSales: row.subtotalAmount, sellerDiscount: null, platformDiscount: null, refund: null, buyerShippingCredit: null, platformSubsidy: null, marketplaceFees: null, paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null, settledProceeds: null, settledProceedsVerified: false, items: row.items.map((item) => ({ id: item.shopifyLineId, productId: item.variantId, productName: item.name, sku: item.sku, imageUrl: item.variantId ? images.get(item.variantId) ?? null : null, quantity: item.currentQuantity, grossSales: (item.discountedPrice ?? item.price) * item.currentQuantity, refund: null, financialQuality: row.financialQuality as NormalizedOrderFinancials["financialQuality"] })) }; });
  }
  const shopIds = selectedShops.map((shop) => shop.id);
  const capabilities = await getMarketplaceCapabilities(platform, shopIds);
  // Both independently persisted checks are required. Missing state is never inferred.
  const operationalCoverage = buildOperationalCoverage(orders, capabilities.orders);
  // Currency validation is still authoritative for every v1 response, but financial
  // calculation is only invoked by the profit metric.
  const reportingCurrency = resolveReportingCurrency(orders, currency);
  const reconciled = await getMarketplaceFinancialReadiness(platform, shopIds);
  const financeReady = metric === "profit" && isFinancialAnalyticsEligible({ platform, shops: selectedShops, finance: capabilities.finance, readinessAndEvidenceApproved: reconciled });
  if (metric === "profit" && !financeReady) orders = orders.map((order) => ({ ...order, financialQuality: "legacy-unverified" }));
  const built = buildResponse(orders, reportingCurrency, shopCount, granularity, metric, financeReady);
  let page: AnalyticsPage | null = null;
  if (metric === "products") {
    const result = paginateAnalyticsValues(built.products, pagination);
    built.products = result.values;
    page = result.page;
  } else if (metric === "buyers") {
    const result = paginateAnalyticsValues(built.buyers.topBuyers, pagination);
    built.buyers.topBuyers = result.values;
    page = result.page;
  }
  const response = { ...built, operationalCoverage, financialCoverage: built.profit.coverage, filters: { shopIds, dateFrom: params.get("dateFrom"), dateTo: params.get("dateTo"), currency, granularity: metric === "revenue-trend" ? requestedGranularity : null }, capabilities, page };
  await setCache(cacheKey, response, 120);
  return response;
}

export function buildOperationalCoverage(orders: NormalizedOrderFinancials[], orderCapability: CapabilityState): OperationalCoverage {
  const dates = orders.map((order) => order.createdAt).sort((a, b) => a.getTime() - b.getTime());
  const unknownQuantityCount = orders.reduce((count, order) => count + order.items.filter((item) => item.quantity === null).length, 0);
  const unknownStatusCount = orders.filter((order) => !order.status || order.status.trim() === "").length;
  const unknownIdentityCount = orders.filter((order) => order.buyerId === null).length;
  const availability = orderCapability === "unauthorized" ? "not_authorized" : orderCapability === "unavailable" ? "unsupported" : orderCapability === "pending" ? "backfilling" : orders.length ? "available" : "no_data";
  const firstObserved = dates.at(0);
  const lastObserved = dates.at(-1);
  return { state: availability === "available" ? (unknownQuantityCount || unknownStatusCount ? "partial" : "ready") : "unavailable", availability, reason: availability === "available" ? null : availability === "no_data" ? "No observed orders match these filters." : availability === "backfilling" ? "Order history is being backfilled." : availability === "not_authorized" ? "Order access is not authorized." : "Order analytics is unavailable for this connection.", observedDateRange: firstObserved && lastObserved ? { from: firstObserved.toISOString().slice(0, 10), to: lastObserved.toISOString().slice(0, 10) } : null, rawOrderCount: orders.length, rawItemCount: orders.reduce((count, order) => count + order.items.length, 0), unknownStatusCount, unknownQuantityCount, unknownIdentityCount, sourceCurrencies: [...new Set(orders.map((order) => order.currency))].sort() };
}

function buildResponse(orders: NormalizedOrderFinancials[], currency: string, shopCount: number, granularity: "daily" | "weekly" | "monthly", metric: string, financeReady: boolean) {
  const profit = metric === "profit" ? calculateProfit(orders, currency) : { grossSales: null, sellerDiscounts: null, refunds: null, netSales: null, buyerShippingCredits: null, platformSubsidies: null, marketplaceFees: null, paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null, estimatedProfit: null, estimatedMargin: null, orderCount: 0, coverage: { state: "unavailable" as const, calculationBasis: "unavailable" as const, financialCoveragePercent: null, buyerIdentityCoveragePercent: 0, missingCostCategories: [], reportingCurrency: currency, conversion: { applied: false as const, sourceCurrencies: [] }, exclusions: [], unavailableReasons: ["profit_not_requested"], rawOrderCount: orders.length, certifiedOrderCount: 0 } };
  if (metric === "profit" && !financeReady) profit.coverage.unavailableReasons = [...new Set([...profit.coverage.unavailableReasons, "finance capability and approved reconciliation are required"])] ;
  const buyers = metric === "buyers" ? calculateBuyerMetrics(orders) : { uniqueBuyers: null, repeatBuyers: null, repeatPurchaseRate: null, averageOrderValue: null, topBuyers: [], availabilityReason: "buyer_metrics_not_requested" };
  const clv = metric === "clv" ? calculateClvMetrics(orders) : { summary: { totalBuyers: 0, historicalNetSales: null, predictedNetRevenueNext12Months: null, method: null, horizonMonths: null, availabilityReason: "predictive_clv_not_requested" }, segments: { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 }, churnRisk: { high: 0, medium: 0, low: 0 }, topBuyersByClv: [] };
  const operationalOrders = orders.filter((order) => !order.status.toLowerCase().includes("cancel"));
  const operationalSales = (values: Array<number | null>) => {
    const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  const products = new Map<string, { productId: string | null; productName: string; sku: string | null; imageUrl: string | null; quantity: number | null; operationalSales: number | null; grossSales: null; estimatedProfit: null }>();
  if (metric === "products") for (const order of operationalOrders) for (const item of order.items) { const key = `${order.shopId}:${item.productId ?? `unmapped:${item.sku ?? item.id}`}`; const prior = products.get(key); products.set(key, { productId: item.productId, productName: item.productName, sku: item.sku, imageUrl: prior?.imageUrl ?? item.imageUrl, quantity: prior?.quantity === null || item.quantity === null ? null : (prior?.quantity ?? 0) + item.quantity, operationalSales: operationalSales([prior?.operationalSales ?? null, item.grossSales]), grossSales: null, estimatedProfit: null }); }
  const bucket = (date: Date) => {
    const day = date.toISOString().slice(0, 10);
    if (granularity === "daily") return day;
    if (granularity === "monthly") return day.slice(0, 7);
    const monday = new Date(`${day}T00:00:00.000Z`); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); return monday.toISOString().slice(0, 10);
  };
  const trend = metric === "revenue-trend" ? [...new Set(operationalOrders.map((order) => bucket(order.createdAt)))].map((date) => { const grouped = operationalOrders.filter((order) => bucket(order.createdAt) === date); return { date, operationalSales: operationalSales(grouped.map((order) => order.grossSales)), grossSales: null, netSales: null, estimatedProfit: null, orders: grouped.length }; }) : [];
  const totalOperationalSales = operationalSales(operationalOrders.map((order) => order.grossSales));
  return { summary: { totalOrders: orders.length, operationalOrderCount: operationalOrders.length, operationalCurrency: currency, operationalSales: totalOperationalSales, certifiedFinancialOrders: metric === "profit" ? profit.orderCount : 0, netSales: null, averageOrderValue: totalOperationalSales === null || operationalOrders.length === 0 ? null : totalOperationalSales / operationalOrders.length, shopCount }, profit, buyers, clv, products: [...products.values()].sort((a, b) => (b.operationalSales ?? -Infinity) - (a.operationalSales ?? -Infinity)), revenueTrend: trend };
}
