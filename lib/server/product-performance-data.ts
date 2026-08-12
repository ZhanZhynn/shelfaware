import prisma from "@/prisma/client";
import type { AdminDataScope } from "@/lib/admin/data-scope";
import type { Prisma } from "@prisma/client";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { decideProduct, DEFAULT_SAFETY_DAYS } from "@/lib/product-performance/decisions";
import type { ContributingSalesSku, MarketplaceCoverage, MarketplaceRevenueEntry, ProductPerformanceData, ProductPerformanceRow } from "@/types/product-performance";

export async function getProductPerformance(userId: string, from: Date, to: Date, dataScope?: Pick<AdminDataScope, "ownerIds" | "sharedAdmin">): Promise<ProductPerformanceData> {
  const ownerIds = dataScope?.ownerIds ?? [userId];
  const productScope: Prisma.ProductWhereInput = dataScope?.sharedAdmin
    ? { OR: [{ userId: { in: ownerIds }, workspaceId: null }, { workspaceId: { not: null } }] }
    : { userId };
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const products = await prisma.product.findMany({
    where: mergeProductListWhere(productScope),
    select: { id: true, name: true, sku: true, quantity: true, reservedQuantity: true, status: true, categoryId: true, supplierId: true, createdAt: true, channelMappings: { where: { channel: "shopee" }, select: { channelProductId: true } } },
  });
  const ids = products.map((product) => product.id);
  const mappedChannelIds = [...new Set(products.flatMap((product) => product.channelMappings.map((mapping) => mapping.channelProductId)))];
  const [items, reviews, categories, suppliers, mappingCounts, wmsFacts] = await Promise.all([
    prisma.orderItem.findMany({ where: { productId: { in: ids }, order: { status: { not: "cancelled" }, createdAt: { gte: from, lte: to }, ...(!dataScope?.sharedAdmin && { userId: { in: ownerIds } }) } }, select: { productId: true, quantity: true, subtotal: true, order: { select: { createdAt: true } } } }),
    prisma.productReview.groupBy({ by: ["productId"], where: { productId: { in: ids }, status: "approved" }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.category.findMany({ where: { id: { in: [...new Set(products.map((product) => product.categoryId))] } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: [...new Set(products.map((product) => product.supplierId))] } }, select: { id: true, leadTimeDays: true } }),
    prisma.productChannelMapping.groupBy({ by: ["channelProductId"], where: { channel: "shopee", channelProductId: { in: mappedChannelIds } }, _count: { _all: true } }),
    ids.length > 0
      ? prisma.wmsProductSalesFact.findMany({
          where: { wmsProductId: { in: ids }, saleDate: { gte: from, lte: to } },
          select: { wmsProductId: true, normalizedUnits: true, allocatedGmvMinor: true, currency: true, amountScale: true, mappingId: true, sourceLine: { select: { offerId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const wmsMappingIds = [...new Set(wmsFacts.map((f) => f.mappingId))];
  const mappingRecords = wmsMappingIds.length > 0
    ? await prisma.marketplaceSkuMapping.findMany({
        where: { id: { in: wmsMappingIds } },
        select: { id: true, salesSkuId: true, salesSku: { select: { id: true, code: true, name: true } } },
      })
    : [];
  const mappingById = new Map(mappingRecords.map((m) => [m.id, m]));
  const allSalesSkuIds = [...new Set(mappingRecords.map((m) => m.salesSkuId))];
  const activeMappingsForSkus = allSalesSkuIds.length > 0
    ? await prisma.marketplaceSkuMapping.findMany({
        where: { salesSkuId: { in: allSalesSkuIds }, effectiveTo: null },
        select: { salesSkuId: true, offerKey: true },
      })
    : [];
  const distinctOffersBySku = new Map<string, Set<string>>();
  for (const m of activeMappingsForSkus) {
    const set = distinctOffersBySku.get(m.salesSkuId) ?? new Set<string>();
    set.add(m.offerKey);
    distinctOffersBySku.set(m.salesSkuId, set);
  }
  const totalOffersMap = new Map<string, number>();
  for (const [skuId, offerKeys] of distinctOffersBySku) totalOffersMap.set(skuId, offerKeys.size);
  const sales = new Map<string, { units: number; revenue: number; early: number; late: number }>();
  const productsById = new Map(products.map((product) => [product.id, product]));
  for (const item of items) {
    const product = productsById.get(item.productId);
    const observedFrom = product ? Math.max(from.getTime(), product.createdAt.getTime()) : from.getTime();
    if (item.order.createdAt.getTime() < observedFrom) continue;
    const current = sales.get(item.productId) ?? { units: 0, revenue: 0, early: 0, late: 0 };
    current.units += item.quantity; current.revenue += item.subtotal;
    if (item.order.createdAt.getTime() < observedFrom + (to.getTime() - observedFrom) / 2) current.early += item.quantity; else current.late += item.quantity;
    sales.set(item.productId, current);
  }
  const reviewMap = new Map(reviews.map((review) => [review.productId, { count: review._count._all, averageRating: review._avg.rating ?? 0 }]));
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.leadTimeDays]));
  const mappingCountMap = new Map(mappingCounts.map((mapping) => [mapping.channelProductId, mapping._count._all]));
  type MarketplaceAgg = { normalizedUnits: number; revenue: Record<string, MarketplaceRevenueEntry>; mappingIds: Set<string>; offerIds: Set<string>; skuUnits: Map<string, number> };
  const marketplaceByProduct = new Map<string, MarketplaceAgg>();
  for (const fact of wmsFacts) {
    const agg = marketplaceByProduct.get(fact.wmsProductId) ?? { normalizedUnits: 0, revenue: {}, mappingIds: new Set<string>(), offerIds: new Set<string>(), skuUnits: new Map<string, number>() };
    agg.normalizedUnits += fact.normalizedUnits;
    const existing = agg.revenue[fact.currency];
    const minor = (existing?.minor ?? 0) + Number(BigInt(fact.allocatedGmvMinor));
    if (existing && existing.scale !== fact.amountScale) {
      console.warn(`[product-performance] amountScale mismatch for currency ${fact.currency}: existing=${existing.scale}, incoming=${fact.amountScale}. Using first observed scale.`);
    }
    agg.revenue[fact.currency] = { minor, scale: existing?.scale ?? fact.amountScale };
    agg.mappingIds.add(fact.mappingId);
    if (fact.sourceLine.offerId) agg.offerIds.add(fact.sourceLine.offerId);
    const mapping = mappingById.get(fact.mappingId);
    if (mapping) {
      const prev = agg.skuUnits.get(mapping.salesSkuId) ?? 0;
      agg.skuUnits.set(mapping.salesSkuId, prev + fact.normalizedUnits);
    }
    marketplaceByProduct.set(fact.wmsProductId, agg);
  }
  const totalRevenue = [...sales.values()].reduce((sum, sale) => sum + sale.revenue, 0);
  const ranked = [...products].sort((a, b) => (sales.get(b.id)?.revenue ?? 0) - (sales.get(a.id)?.revenue ?? 0));
  let cumulative = 0;
  const rows: ProductPerformanceRow[] = ranked.map((product) => {
    const sale = sales.get(product.id) ?? { units: 0, revenue: 0, early: 0, late: 0 };
    const share = totalRevenue ? sale.revenue / totalRevenue : 0; cumulative += share;
    const tier = totalRevenue ? (cumulative <= .8 ? "A" : cumulative <= .95 ? "B" : "C") : null;
    const onHand = Number(product.quantity); const reserved = Number(product.reservedQuantity); const available = Math.max(0, onHand - reserved);
    const observedFrom = new Date(Math.max(from.getTime(), product.createdAt.getTime()));
    const observedDays = Math.max(0, Math.ceil((to.getTime() - observedFrom.getTime()) / 86_400_000));
    const coverageComplete = observedDays >= 7;
    const velocity = coverageComplete ? sale.units / observedDays : 0; const trend = coverageComplete && observedDays >= 14 && sale.early > 0 ? (sale.late < sale.early * .8 ? "decreasing" : sale.late > sale.early * 1.2 ? "increasing" : "stable") : null;
    const active = !["inactive", "deleted", "disabled"].includes(product.status.toLowerCase());
    const reviewQuality = reviewMap.get(product.id) ?? null;
    const leadTimeDays = supplierMap.get(product.supplierId) ?? null;
    const decision = decideProduct({ active, coverageComplete, unitsSold: sale.units, available, dailyVelocity: coverageComplete ? velocity : null, leadTimeDays, trend, reviewQuality });
    const mapped = product.channelMappings.some((mapping) => mappingCountMap.get(mapping.channelProductId) === 1);
    const mAgg = marketplaceByProduct.get(product.id);
    const marketplaceNormalizedUnits = mAgg ? mAgg.normalizedUnits : null;
    const marketplaceRevenue = mAgg ? mAgg.revenue : null;
    let marketplaceCoverage: MarketplaceCoverage | null = null;
    let contributingSalesSkus: ContributingSalesSku[] | null = null;
    if (mAgg && mAgg.mappingIds.size > 0) {
      const mappedOffers = mAgg.offerIds.size;
      let totalOfferCount = 0;
      const seenSkuIds = new Set<string>();
      for (const mappingId of mAgg.mappingIds) {
        const mapping = mappingById.get(mappingId);
        if (!mapping || seenSkuIds.has(mapping.salesSkuId)) continue;
        seenSkuIds.add(mapping.salesSkuId);
        totalOfferCount += totalOffersMap.get(mapping.salesSkuId) ?? 0;
      }
      marketplaceCoverage = { mappedOffers, totalOffers: totalOfferCount, mappingPercent: totalOfferCount > 0 ? Math.round((mappedOffers / totalOfferCount) * 100) : 0 };
      contributingSalesSkus = [];
      for (const [skuId, units] of mAgg.skuUnits) {
        const mapping = [...mappingById.values()].find((m) => m.salesSkuId === skuId);
        if (mapping) contributingSalesSkus.push({ id: mapping.salesSku.id, code: mapping.salesSku.code, name: mapping.salesSku.name, units });
      }
    }
    const marketplaceReasons: string[] = [];
    if (marketplaceCoverage && marketplaceCoverage.mappingPercent < 50 && marketplaceNormalizedUnits !== null && marketplaceNormalizedUnits > 0) {
      marketplaceReasons.push("low-marketplace-mapping-coverage");
    }
    return { id: product.id, name: product.name, sku: product.sku, category: categoryMap.get(product.categoryId) ?? null, tier, revenue: sale.revenue, unitsSold: sale.units, onHand, reserved, available, dailyVelocity: velocity || null, daysOfCover: velocity > 0 ? Math.round(available / velocity) : null, trend, stockStatus: available === 0 ? (onHand > 0 ? "reserved-out" : "out-of-stock") : "in-stock", supplierLeadTimeDays: leadTimeDays, inboundQuantity: null, recommendation: decision.recommendation, reasons: [...decision.reasons, ...marketplaceReasons], confidence: coverageComplete ? (observedDays >= 30 ? "high" : "medium") : "needs-data", coverage: coverageComplete ? `${observedDays} observed days of WMS orders` : `${observedDays} observed days; at least 7 are required`, suggestedQuantity: decision.suggestedQuantity, shopeeCoverage: mapped ? "mapped" : product.channelMappings.length ? "needs-mapping" : "not-connected", reviewQuality, marketplaceNormalizedUnits, marketplaceRevenue, marketplaceCoverage, contributingSalesSkus };
  });
  const summary = { "needs-data": 0, restock: 0, "review-excess": 0, "review-listing": 0, healthy: 0 };
  for (const row of rows) summary[row.recommendation]++;
  return { period: { from: from.toISOString(), to: to.toISOString(), days }, defaults: { safetyDays: DEFAULT_SAFETY_DAYS }, products: rows, summary };
}
