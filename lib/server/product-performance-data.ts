import prisma from "@/prisma/client";
import type { AdminDataScope } from "@/lib/admin/data-scope";
import type { Prisma } from "@prisma/client";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { decideProduct, DEFAULT_MAX_COVER_DAYS, DEFAULT_SAFETY_DAYS } from "@/lib/product-performance/decisions";
import type { ChannelDemand, ContributingSalesSku, DemandPerformance, MarketplaceAttribution, MarketplaceCoverage, MarketplaceRevenueEntry, ProductPerformanceData, ProductPerformanceRow, ProductRecommendation, ProductTier } from "@/types/product-performance";

const DAY_MS = 86_400_000;
const QUALIFIED_ORDER_STATUSES = ["confirmed", "processing", "shipped", "delivered"];
const RELIABLE_INBOUND_STATUSES = ["ordered", "shipping"];
export type ProductPerformanceView = ProductRecommendation | "action" | "overstock" | "all";
export type ProductPerformanceOptions = {
  view?: ProductPerformanceView;
  page?: number;
  pageSize?: number;
  tier?: Exclude<ProductTier, null>;
  demandPerformance?: DemandPerformance;
  channel?: string;
  category?: string;
  search?: string;
};

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function projectStockoutDate(asOf: Date, available: number, dailyVelocity: number | null, receipts: { quantity: number; date: Date | null }[]) {
  if (!dailyVelocity || dailyVelocity <= 0) return null;
  let cursor = asOf;
  let balance = available;
  const scheduled = receipts
    .filter((receipt): receipt is { quantity: number; date: Date } => receipt.date !== null && receipt.date >= asOf)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const receipt of scheduled) {
    const depletion = addDays(cursor, balance / dailyVelocity);
    if (receipt.date > depletion) return depletion;
    balance = Math.max(0, balance - dailyVelocity * ((receipt.date.getTime() - cursor.getTime()) / DAY_MS)) + receipt.quantity;
    cursor = receipt.date;
  }
  return addDays(cursor, balance / dailyVelocity);
}

export async function getProductPerformance(userId: string, from: Date, to: Date, dataScope?: Pick<AdminDataScope, "ownerIds" | "sharedAdmin">, options?: ProductPerformanceOptions): Promise<ProductPerformanceData> {
  const ownerIds = dataScope?.ownerIds ?? [userId];
  const productScope: Prisma.ProductWhereInput = dataScope?.sharedAdmin
    ? { OR: [{ userId: { in: ownerIds }, workspaceId: null }, { workspaceId: { not: null } }] }
    : { userId };
  const purchaseOrderScope: Prisma.PurchaseOrderWhereInput = dataScope?.sharedAdmin
    ? { OR: [{ userId: { in: ownerIds }, workspaceId: null }, { workspaceId: { not: null } }] }
    : { userId: { in: ownerIds } };
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  const products = await prisma.product.findMany({
    where: mergeProductListWhere(productScope),
    select: { id: true, name: true, sku: true, quantity: true, reservedQuantity: true, status: true, categoryId: true, supplierId: true, createdAt: true },
  });
  const ids = products.map((product) => product.id);

  // Query parent records first to avoid Prisma cross-collection scans on MongoDB.
  const [orders, reviews, categories, suppliers, wmsFacts, openPurchaseOrders, rawShopeeOrderItems] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: QUALIFIED_ORDER_STATUSES },
        createdAt: { gte: from, lte: to },
        ...(!dataScope?.sharedAdmin && { userId: { in: ownerIds } }),
      },
      select: { id: true, createdAt: true },
    }),
    prisma.productReview.groupBy({ by: ["productId"], where: { productId: { in: ids }, status: "approved" }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.category.findMany({ where: { id: { in: [...new Set(products.map((product) => product.categoryId))] } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: [...new Set(products.map((product) => product.supplierId))] } }, select: { id: true, leadTimeDays: true } }),
    ids.length > 0
      ? prisma.wmsProductSalesFact.findMany({
          where: { wmsProductId: { in: ids }, saleDate: { gte: from, lte: to } },
          select: {
            wmsProductId: true,
            normalizedUnits: true,
            allocatedGmvMinor: true,
            currency: true,
            amountScale: true,
            mappingId: true,
            saleDate: true,
            sourceLine: { select: { offerId: true, platform: true, marketplaceQuantity: true, orderEligibility: true } },
          },
        })
      : Promise.resolve([]),
    prisma.purchaseOrder.findMany({
      where: { ...purchaseOrderScope, status: { in: RELIABLE_INBOUND_STATUSES } },
      select: { id: true, estimatedDelivery: true },
    }),
    prisma.shopeeOrderItem.count({
      where: {
        order: {
          shopeeCreatedAt: { gte: from, lte: to },
          ...(!dataScope?.sharedAdmin && { userId: { in: ownerIds } }),
        },
      },
    }),
  ]);

  const orderIds = orders.map((order) => order.id);
  const purchaseOrderIds = openPurchaseOrders.map((order) => order.id);
  const eligibleWmsFacts = wmsFacts.filter((fact) => fact.sourceLine.orderEligibility === "eligible");
  const attribution: MarketplaceAttribution = {
    rawShopeeOrderItems,
    normalizedComponentFacts: eligibleWmsFacts.length,
    state: rawShopeeOrderItems === 0 ? "no-shopee-sales" : eligibleWmsFacts.length === 0 ? "unprojected" : "partial",
  };
  const mappingIds = [...new Set(eligibleWmsFacts.map((fact) => fact.mappingId))];
  const [items, purchaseOrderItems, mappingRecords] = await Promise.all([
    orderIds.length > 0
      ? prisma.orderItem.findMany({
          where: { productId: { in: ids }, orderId: { in: orderIds } },
          select: { productId: true, quantity: true, subtotal: true, orderId: true },
        })
      : Promise.resolve([]),
    purchaseOrderIds.length > 0
      ? prisma.purchaseOrderItem.findMany({
          where: { productId: { in: ids }, purchaseOrderId: { in: purchaseOrderIds } },
          select: { productId: true, purchaseOrderId: true, quantity: true, quantityReceived: true },
        })
      : Promise.resolve([]),
    mappingIds.length > 0
      ? prisma.marketplaceSkuMapping.findMany({
          where: { id: { in: mappingIds } },
          select: { id: true, salesSkuId: true, salesSku: { select: { id: true, code: true, name: true, isKit: true } } },
        })
      : Promise.resolve([]),
  ]);

  const allSalesSkuIds = [...new Set(mappingRecords.map((mapping) => mapping.salesSkuId))];
  const activeMappingsForSkus = allSalesSkuIds.length > 0
    ? await prisma.marketplaceSkuMapping.findMany({
        where: { salesSkuId: { in: allSalesSkuIds }, effectiveTo: null },
        select: { salesSkuId: true, offerKey: true },
      })
    : [];

  const orderDateById = new Map(orders.map((order) => [order.id, order.createdAt]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const sales = new Map<string, { units: number; revenue: number; early: number; late: number }>();
  for (const item of items) {
    const product = productsById.get(item.productId);
    const orderCreatedAt = orderDateById.get(item.orderId);
    if (!orderCreatedAt) continue;
    const observedFrom = product ? Math.max(from.getTime(), product.createdAt.getTime()) : from.getTime();
    if (orderCreatedAt.getTime() < observedFrom) continue;
    const current = sales.get(item.productId) ?? { units: 0, revenue: 0, early: 0, late: 0 };
    current.units += item.quantity;
    current.revenue += item.subtotal;
    if (orderCreatedAt.getTime() < observedFrom + (to.getTime() - observedFrom) / 2) current.early += item.quantity;
    else current.late += item.quantity;
    sales.set(item.productId, current);
  }

  const purchaseOrderById = new Map(openPurchaseOrders.map((order) => [order.id, order]));
  const inboundByProduct = new Map<string, { quantity: number; nextDate: Date | null; receipts: { quantity: number; date: Date | null }[] }>();
  for (const item of purchaseOrderItems) {
    const remaining = Math.max(0, item.quantity - item.quantityReceived);
    if (remaining === 0) continue;
    const delivery = purchaseOrderById.get(item.purchaseOrderId)?.estimatedDelivery ?? null;
    const current = inboundByProduct.get(item.productId) ?? { quantity: 0, nextDate: null, receipts: [] };
    current.quantity += remaining;
    current.receipts.push({ quantity: remaining, date: delivery });
    if (delivery && (!current.nextDate || delivery < current.nextDate)) current.nextDate = delivery;
    inboundByProduct.set(item.productId, current);
  }

  const mappingById = new Map(mappingRecords.map((mapping) => [mapping.id, mapping]));
  const linkedOffersBySku = new Map<string, Set<string>>();
  for (const mapping of activeMappingsForSkus) {
    const offers = linkedOffersBySku.get(mapping.salesSkuId) ?? new Set<string>();
    offers.add(mapping.offerKey);
    linkedOffersBySku.set(mapping.salesSkuId, offers);
  }

  type SalesSkuAgg = { normalizedUnits: number; marketplaceUnits: number; quantityKnown: boolean; channels: Set<string> };
  type MarketplaceAgg = {
    normalizedUnits: number;
    revenue: Record<string, MarketplaceRevenueEntry>;
    mappingIds: Set<string>;
    offerIds: Set<string>;
    skuUnits: Map<string, SalesSkuAgg>;
    channelDemand: Record<string, ChannelDemand>;
    early: number;
    late: number;
  };
  const marketplaceByProduct = new Map<string, MarketplaceAgg>();
  const midpoint = from.getTime() + (to.getTime() - from.getTime()) / 2;
  for (const fact of eligibleWmsFacts) {
    const agg = marketplaceByProduct.get(fact.wmsProductId) ?? {
      normalizedUnits: 0,
      revenue: {},
      mappingIds: new Set<string>(),
      offerIds: new Set<string>(),
      skuUnits: new Map<string, SalesSkuAgg>(),
      channelDemand: {},
      early: 0,
      late: 0,
    };
    agg.normalizedUnits += fact.normalizedUnits;
    if (fact.saleDate.getTime() < midpoint) agg.early += fact.normalizedUnits;
    else agg.late += fact.normalizedUnits;
    const existingRevenue = agg.revenue[fact.currency];
    const minor = (existingRevenue?.minor ?? 0) + Number(BigInt(fact.allocatedGmvMinor));
    if (existingRevenue && existingRevenue.scale !== fact.amountScale) {
      console.warn(`[product-performance] amountScale mismatch for currency ${fact.currency}: existing=${existingRevenue.scale}, incoming=${fact.amountScale}. Using first observed scale.`);
    }
    agg.revenue[fact.currency] = { minor, scale: existingRevenue?.scale ?? fact.amountScale };
    agg.mappingIds.add(fact.mappingId);
    if (fact.sourceLine.offerId) agg.offerIds.add(fact.sourceLine.offerId);
    const channel = fact.sourceLine.platform.toLowerCase();
    const channelDemand = agg.channelDemand[channel] ?? { normalizedUnits: 0, marketplaceUnits: 0 };
    channelDemand.normalizedUnits += fact.normalizedUnits;
    channelDemand.marketplaceUnits += fact.sourceLine.marketplaceQuantity ?? 0;
    agg.channelDemand[channel] = channelDemand;
    const mapping = mappingById.get(fact.mappingId);
    if (mapping) {
      const sku = agg.skuUnits.get(mapping.salesSkuId) ?? { normalizedUnits: 0, marketplaceUnits: 0, quantityKnown: true, channels: new Set<string>() };
      sku.normalizedUnits += fact.normalizedUnits;
      if (fact.sourceLine.marketplaceQuantity === null) sku.quantityKnown = false;
      else sku.marketplaceUnits += fact.sourceLine.marketplaceQuantity;
      sku.channels.add(channel);
      agg.skuUnits.set(mapping.salesSkuId, sku);
    }
    marketplaceByProduct.set(fact.wmsProductId, agg);
  }

  const reviewMap = new Map(reviews.map((review) => [review.productId, { count: review._count._all, averageRating: review._avg.rating ?? 0 }]));
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.leadTimeDays]));
  const totalRevenue = [...sales.values()].reduce((sum, sale) => sum + sale.revenue, 0);
  const ranked = [...products].sort((a, b) => (sales.get(b.id)?.revenue ?? 0) - (sales.get(a.id)?.revenue ?? 0));
  const asOf = new Date();
  let cumulative = 0;

  const rows: ProductPerformanceRow[] = ranked.map((product) => {
    const sale = sales.get(product.id) ?? { units: 0, revenue: 0, early: 0, late: 0 };
    const share = totalRevenue ? sale.revenue / totalRevenue : 0;
    cumulative += share;
    const tier = totalRevenue ? (cumulative <= 0.8 ? "A" : cumulative <= 0.95 ? "B" : "C") : null;
    const onHand = Number(product.quantity);
    const reserved = Number(product.reservedQuantity);
    const available = Math.max(0, onHand - reserved);
    const inbound = inboundByProduct.get(product.id) ?? { quantity: 0, nextDate: null, receipts: [] };
    const inventoryPosition = available + inbound.quantity;
    const observedFrom = new Date(Math.max(from.getTime(), product.createdAt.getTime()));
    const observedDays = Math.max(0, Math.ceil((to.getTime() - observedFrom.getTime()) / DAY_MS));
    const coverageComplete = observedDays >= 7;
    const marketplace = marketplaceByProduct.get(product.id);
    const marketplaceUnits = marketplace?.normalizedUnits ?? 0;
    const totalNormalizedUnits = sale.units + marketplaceUnits;
    const velocity = coverageComplete ? totalNormalizedUnits / observedDays : null;
    const combinedEarly = sale.early + (marketplace?.early ?? 0);
    const combinedLate = sale.late + (marketplace?.late ?? 0);
    const trend = coverageComplete && observedDays >= 14 && combinedEarly > 0
      ? combinedLate < combinedEarly * 0.8 ? "decreasing" : combinedLate > combinedEarly * 1.2 ? "increasing" : "stable"
      : null;
    const demandPerformance = !coverageComplete ? "insufficient-data" : totalNormalizedUnits === 0 ? "no-demand" : trend === "increasing" ? "growing" : trend === "decreasing" ? "declining" : "stable";
    const leadTimeDays = supplierMap.get(product.supplierId) ?? null;
    const projectedStockoutDate = projectStockoutDate(asOf, available, velocity, inbound.receipts);
    const reorderByDate = projectedStockoutDate && leadTimeDays !== null ? addDays(projectedStockoutDate, -leadTimeDays) : null;
    const willStockOutWithinLeadTime = projectedStockoutDate !== null && leadTimeDays !== null && projectedStockoutDate <= addDays(asOf, leadTimeDays);
    const active = !["inactive", "deleted", "disabled"].includes(product.status.toLowerCase());
    const decision = decideProduct({
      active,
      coverageComplete,
      totalUnitsSold: totalNormalizedUnits,
      available,
      inboundQuantity: inbound.quantity,
      dailyVelocity: velocity,
      leadTimeDays,
      projectedStockoutDate,
      willStockOutWithinLeadTime,
      trend,
    });
    const reviewQuality = reviewMap.get(product.id) ?? null;
    const commercialSignals: string[] = [];
    if (trend === "decreasing") commercialSignals.push("declining-demand");
    if (reviewQuality && reviewQuality.count >= 3 && reviewQuality.averageRating < 3.5) commercialSignals.push("low-review-quality");
    const confidenceReasons: string[] = [];
    if (!active) confidenceReasons.push("inactive-product");
    if (!coverageComplete) confidenceReasons.push("insufficient-history");
    if (velocity && velocity > 0 && leadTimeDays === null) confidenceReasons.push("missing-supplier-lead-time");
    const confidence = confidenceReasons.length > 0 ? "needs-data" : observedDays >= 30 ? "high" : "medium";

    let marketplaceCoverage: MarketplaceCoverage | null = null;
    let contributingSalesSkus: ContributingSalesSku[] | null = null;
    if (marketplace && marketplace.mappingIds.size > 0) {
      const seenSkuIds = new Set<string>();
      let linkedOffers = 0;
      for (const mappingId of marketplace.mappingIds) {
        const mapping = mappingById.get(mappingId);
        if (!mapping || seenSkuIds.has(mapping.salesSkuId)) continue;
        seenSkuIds.add(mapping.salesSkuId);
        linkedOffers += linkedOffersBySku.get(mapping.salesSkuId)?.size ?? 0;
      }
      marketplaceCoverage = {
        observedOffers: marketplace.offerIds.size,
        linkedOffers,
        activityPercent: linkedOffers > 0 ? Math.round((marketplace.offerIds.size / linkedOffers) * 100) : 0,
      };
      contributingSalesSkus = [];
      for (const [salesSkuId, skuAgg] of marketplace.skuUnits) {
        const mapping = [...mappingById.values()].find((candidate) => candidate.salesSkuId === salesSkuId);
        if (!mapping) continue;
        const marketplaceQuantity = skuAgg.quantityKnown ? skuAgg.marketplaceUnits : null;
        const unitsPerSale = marketplaceQuantity && marketplaceQuantity > 0 ? skuAgg.normalizedUnits / marketplaceQuantity : null;
        contributingSalesSkus.push({
          id: mapping.salesSku.id,
          code: mapping.salesSku.code,
          name: mapping.salesSku.name,
          isKit: mapping.salesSku.isKit,
          normalizedUnits: skuAgg.normalizedUnits,
          marketplaceUnits: marketplaceQuantity,
          unitsPerSale,
          componentSupportedQuantity: unitsPerSale && unitsPerSale > 0 ? Math.floor(available / unitsPerSale) : null,
          channels: [...skuAgg.channels].sort(),
        });
      }
      contributingSalesSkus.sort((a, b) => b.normalizedUnits - a.normalizedUnits);
    }

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: categoryMap.get(product.categoryId) ?? null,
      tier,
      revenue: sale.revenue,
      unitsSold: sale.units,
      totalNormalizedUnits,
      onHand,
      reserved,
      available,
      inboundQuantity: inbound.quantity,
      inventoryPosition,
      nextInboundDate: inbound.nextDate?.toISOString() ?? null,
      wmsDailyVelocity: coverageComplete ? sale.units / observedDays : null,
      marketplaceDailyVelocity: coverageComplete ? marketplaceUnits / observedDays : null,
      dailyVelocity: velocity,
      daysOfCover: velocity && velocity > 0 ? Math.round(available / velocity) : null,
      inventoryPositionDaysOfCover: velocity && velocity > 0 ? Math.round(inventoryPosition / velocity) : null,
      targetCoverDays: leadTimeDays === null ? null : leadTimeDays + DEFAULT_SAFETY_DAYS,
      projectedStockoutDate: projectedStockoutDate?.toISOString() ?? null,
      reorderByDate: reorderByDate?.toISOString() ?? null,
      trend,
      demandPerformance,
      commercialSignals,
      stockStatus: available === 0 ? (onHand > 0 ? "reserved-out" : "out-of-stock") : "in-stock",
      supplierLeadTimeDays: leadTimeDays,
      recommendation: decision.recommendation,
      reasons: decision.reasons,
      confidence,
      confidenceReasons,
      coverage: coverageComplete
        ? `${observedDays} observed days; ${sale.units} WMS + ${marketplaceUnits} marketplace component units`
        : `${observedDays} observed days; at least 7 are required`,
      suggestedQuantity: decision.suggestedQuantity,
      reviewQuality,
      marketplaceNormalizedUnits: marketplace ? marketplace.normalizedUnits : null,
      marketplaceRevenue: marketplace ? marketplace.revenue : null,
      marketplaceCoverage,
      channelDemand: marketplace ? marketplace.channelDemand : null,
      contributingSalesSkus,
    };
  });

  const summary: ProductPerformanceData["summary"] = { inactive: 0, critical: 0, reorder: 0, watch: 0, healthy: 0, excess: 0, dormant: 0, "not-stocked": 0, "data-issue": 0, action: 0 };
  for (const row of rows) summary[row.recommendation]++;
  summary.action = summary.critical + summary.reorder + summary.watch + summary.excess + summary.dormant + summary["data-issue"];
  const view = options?.view ?? "all";
  const matchingRows = rows.filter((row) =>
    (view === "all"
      || view === "action" && ["critical", "reorder", "watch", "excess", "dormant", "data-issue"].includes(row.recommendation)
      || view === "overstock" && (row.recommendation === "excess" || row.recommendation === "dormant")
      || row.recommendation === view)
    && (!options?.tier || row.tier === options.tier)
    && (!options?.demandPerformance || row.demandPerformance === options.demandPerformance)
    && (!options?.channel || Boolean(row.channelDemand?.[options.channel]))
    && (!options?.category || row.category === options.category)
    && (!options?.search || `${row.name} ${row.sku}`.toLowerCase().includes(options.search.toLowerCase()))
  );
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? (matchingRows.length || 1)));
  const totalPages = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const page = Math.min(Math.max(0, options?.page ?? 0), totalPages - 1);
  return {
    period: { from: from.toISOString(), to: to.toISOString(), days },
    defaults: { safetyDays: DEFAULT_SAFETY_DAYS, maxCoverDays: DEFAULT_MAX_COVER_DAYS },
    products: matchingRows.slice(page * pageSize, (page + 1) * pageSize),
    summary,
    pagination: { page, pageSize, total: matchingRows.length, totalPages },
    attribution,
  };
}
