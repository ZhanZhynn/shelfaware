import prisma from "@/prisma/client";
import type { AdminDataScope } from "@/lib/admin/data-scope";
import { logger } from "@/lib/logger";
import type {
  AbcAnalysisData,
  AbcProduct,
  AbcParetoPoint,
  AbcRecommendations,
  AbcTierSummary,
} from "@/types/abc-analysis";

interface ProductSales {
  productId: string;
  productName: string;
  sku: string;
  category?: string;
  channel: "WMS" | "Shopee" | "Both";
  revenue: number;
  unitsSold: number;
  price: number;
  stock: number;
}

export async function getAbcAnalysisForUser(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
  channel?: string,
  dataScope?: Pick<AdminDataScope, "ownerIds">,
): Promise<AbcAnalysisData> {
  const now = new Date();
  const defaultDateFrom = new Date(now);
  defaultDateFrom.setDate(defaultDateFrom.getDate() - 30);

  const from = dateFrom ? new Date(dateFrom) : defaultDateFrom;
  const to = dateTo ? new Date(dateTo) : now;

  const daysInPeriod = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

  const fetchWms = channel !== "shopee";
  const fetchShopee = channel !== "wms";
  const ownerIds = dataScope?.ownerIds ?? [userId];

  const productSalesMap = new Map<string, ProductSales>();

  if (fetchWms) {
    try {
      const wmsItems = await prisma.orderItem.findMany({
        where: {
          order: {
            userId: { in: ownerIds },
            createdAt: { gte: from, lte: to },
            status: { not: "cancelled" },
          },
        },
        include: {
          order: { select: { createdAt: true } },
        },
      });

      const productIds = [...new Set(wmsItems.map((i) => i.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, price: true, quantity: true },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      for (const item of wmsItems) {
        const key = `wms-${item.productId}`;
        const product = productMap.get(item.productId);
        const price = product?.price ?? item.price;
        const stock = product ? Number(product.quantity) : 0;
        const existing = productSalesMap.get(key);
        if (existing) {
          existing.revenue += item.subtotal;
          existing.unitsSold += item.quantity;
        } else {
          productSalesMap.set(key, {
            productId: item.productId,
            productName: product?.name ?? item.productName,
            sku: product?.sku ?? item.sku ?? "",
            channel: "WMS",
            revenue: item.subtotal,
            unitsSold: item.quantity,
            price,
            stock,
          });
        }
      }
    } catch (error) {
      logger.error("ABC analysis: WMS query failed", error);
    }
  }

  if (fetchShopee) {
    try {
      const shops = await prisma.shopeeShop.findMany({
        where: { userId: { in: ownerIds } },
        select: { id: true },
      });
      const shopIds = shops.map((s) => s.id);

      if (shopIds.length > 0) {
        const shopeeItems = await prisma.shopeeOrderItem.findMany({
          where: {
            order: {
              shopId: { in: shopIds },
              orderStatus: { not: "CANCELLED" },
              shopeeCreatedAt: { gte: from, lte: to },
            },
          },
          include: {
            order: { select: { shopId: true } },
            variant: {
              select: {
                id: true,
                modelName: true,
                itemSku: true,
                price: true,
                stock: true,
                product: { select: { id: true, itemName: true, itemSku: true, price: true, stock: true } },
              },
            },
          },
        });

        const unlinkedModelIds = [
          ...new Set(
            shopeeItems
              .filter((item) => !item.variant && item.shopeeModelId)
              .map((item) => item.shopeeModelId as number),
          ),
        ];
        const fallbackVariants = unlinkedModelIds.length > 0
          ? await prisma.shopeeProductVariant.findMany({
              where: { shopId: { in: shopIds }, modelId: { in: unlinkedModelIds } },
              select: {
                id: true,
                modelName: true,
                itemSku: true,
                price: true,
                stock: true,
                product: { select: { id: true, itemName: true, itemSku: true, price: true, stock: true } },
                shopId: true,
                modelId: true,
              },
            })
          : [];
        const fallbackVariantLookup = new Map(
          fallbackVariants.map((variant) => [`${variant.shopId}:${variant.modelId}`, variant]),
        );
        const unlinkedSkus = [
          ...new Set(
            shopeeItems
              .filter((item) => !item.variant && item.sku)
              .map((item) => item.sku as string),
          ),
        ];
        const fallbackProducts = unlinkedSkus.length > 0
          ? await prisma.shopeeProduct.findMany({
              where: { shopId: { in: shopIds }, itemSku: { in: unlinkedSkus } },
              select: { id: true, shopId: true, itemName: true, itemSku: true, price: true, stock: true },
            })
          : [];
        const fallbackProductCandidates = new Map<string, typeof fallbackProducts>();
        for (const product of fallbackProducts) {
          const key = `${product.shopId}:${product.itemSku}:${product.itemName}`;
          fallbackProductCandidates.set(key, [...(fallbackProductCandidates.get(key) ?? []), product]);
        }
        const fallbackProductLookup = new Map(
          [...fallbackProductCandidates]
            .filter(([, products]) => products.length === 1)
            .map(([key, products]) => [key, products[0]]),
        );

        // Fetch all channel mappings for Shopee products AND variants to enable merging
        const shopeeProductIds = [
          ...new Set(shopeeItems.map((item) => {
            const variant = item.variant ?? fallbackVariantLookup.get(`${item.order.shopId}:${item.shopeeModelId}`);
            const product = fallbackProductLookup.get(`${item.order.shopId}:${item.sku}:${item.productName}`);
            return variant?.product?.id ?? product?.id;
          }).filter(Boolean) as string[]),
        ];
        const shopeeVariantIds = [
          ...new Set(shopeeItems.map((item) => {
            const variant = item.variant ?? fallbackVariantLookup.get(`${item.order.shopId}:${item.shopeeModelId}`);
            return variant?.id;
          }).filter(Boolean) as string[]),
        ];
        const allChannelIds = [...new Set([...shopeeProductIds, ...shopeeVariantIds])];
        const channelMappings = allChannelIds.length > 0
          ? await prisma.productChannelMapping.findMany({
              where: {
                channel: "shopee",
                channelProductId: { in: allChannelIds },
              },
              select: { channelProductId: true, wmsProductId: true },
            })
          : [];
        const mappingLookup = new Map(channelMappings.map((m) => [m.channelProductId, m.wmsProductId]));

        for (const item of shopeeItems) {
          const name = item.productName;
          const sku = item.sku ?? "";
          const price = item.price;
          const variant = item.variant ?? fallbackVariantLookup.get(`${item.order.shopId}:${item.shopeeModelId}`);
          const product = fallbackProductLookup.get(`${item.order.shopId}:${item.sku}:${item.productName}`);
          const stock = variant?.stock ?? variant?.product?.stock ?? product?.stock;
          const variantId = variant?.id;
          const shopeeProductId = variant?.product?.id ?? product?.id;
          // Check variant-level mapping first, then parent product-level
          const mappedWmsProductId = (variantId ? mappingLookup.get(variantId) : undefined)
            || (shopeeProductId ? mappingLookup.get(shopeeProductId) : undefined);

          // If mapped to a WMS product, merge with existing WMS entry or create "Both" entry
          if (mappedWmsProductId) {
            const wmsKey = `wms-${mappedWmsProductId}`;
            const existingWms = productSalesMap.get(wmsKey);
            if (existingWms) {
              existingWms.revenue += item.subtotal;
              existingWms.unitsSold += item.quantity;
              existingWms.channel = "Both";
            } else {
              productSalesMap.set(`shopee-${sku}-${name}`, {
                productId: mappedWmsProductId,
                productName: name,
                sku,
                channel: "Both",
                revenue: item.subtotal,
                unitsSold: item.quantity,
                price,
                stock: stock ?? 0,
              });
            }
          } else {
            // Unmapped Shopee product — keep as separate Shopee entry
            const productKey = `${sku}-${name}`;
            const existing = productSalesMap.get(`shopee-${productKey}`);
            if (existing) {
              existing.revenue += item.subtotal;
              existing.unitsSold += item.quantity;
              // Early order syncs can lack a variant link; preserve current stock once a linked item is found.
              if (stock !== undefined) existing.stock = stock;
            } else {
              productSalesMap.set(`shopee-${productKey}`, {
                productId: variantId ?? item.productId ?? `shopee-${productKey}`,
                productName: name,
                sku,
                channel: "Shopee",
                revenue: item.subtotal,
                unitsSold: item.quantity,
                price,
                stock: stock ?? 0,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error("ABC analysis: Shopee query failed", error);
    }
  }

  const salesArray = Array.from(productSalesMap.values());
  salesArray.sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = salesArray.reduce((sum, s) => sum + s.revenue, 0);
  const totalStockValue = salesArray.reduce((sum, s) => sum + s.price * s.stock, 0);

  let cumulative = 0;
  const products: AbcProduct[] = salesArray.map((s) => {
    const revenuePercent = totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0;
    cumulative += revenuePercent;
    let tier: "A" | "B" | "C";
    if (cumulative <= 80) tier = "A";
    else if (cumulative <= 95) tier = "B";
    else tier = "C";

    const holdingValue = s.price * s.stock;
    const dailySalesRate = s.unitsSold / daysInPeriod;
    const daysOfStock = dailySalesRate > 0 ? Math.round(s.stock / dailySalesRate) : null;

    return {
      id: s.productId,
      name: s.productName,
      sku: s.sku,
      channel: s.channel,
      revenue: Math.round(s.revenue * 100) / 100,
      revenuePercent: Math.round(revenuePercent * 100) / 100,
      cumulativePercent: Math.round(cumulative * 100) / 100,
      tier,
      unitsSold: s.unitsSold,
      stockOnHand: s.stock,
      unitPrice: Math.round(s.price * 100) / 100,
      holdingValue: Math.round(holdingValue * 100) / 100,
      daysOfStock,
    };
  });

  const tierSummary = (tier: "A" | "B" | "C"): AbcTierSummary => {
    const items = products.filter((p) => p.tier === tier);
    return {
      count: items.length,
      revenue: Math.round(items.reduce((s, p) => s + p.revenue, 0) * 100) / 100,
      revenuePercent:
        items.length > 0 ? Math.round(items.reduce((s, p) => s + p.revenuePercent, 0) * 100) / 100 : 0,
      stockValue: Math.round(items.reduce((s, p) => s + p.holdingValue, 0) * 100) / 100,
    };
  };

  const summary = {
    totalProducts: products.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalStockValue: Math.round(totalStockValue * 100) / 100,
    tierA: tierSummary("A"),
    tierB: tierSummary("B"),
    tierC: tierSummary("C"),
  };

  let cumRevenue = 0;
  const paretoData: AbcParetoPoint[] = products.slice(0, 30).map((p) => {
    cumRevenue += p.revenue;
    return {
      product: p.name.length > 20 ? p.name.slice(0, 20) + "…" : p.name,
      revenue: p.revenue,
      cumulativePercent: totalRevenue > 0 ? Math.round((cumRevenue / totalRevenue) * 10000) / 100 : 0,
    };
  });

  const recommendations: AbcRecommendations = {
    deadStock: products.filter(
      (p) => p.tier === "C" && p.holdingValue > 500 && p.daysOfStock !== null && p.daysOfStock > 90,
    ),
    priorityRestock: products.filter(
      (p) => p.tier === "A" && p.daysOfStock !== null && p.daysOfStock < 14,
    ),
    overstocked: products.filter(
      (p) => p.daysOfStock !== null && p.daysOfStock > 90,
    ),
  };

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    products,
    summary,
    recommendations,
    paretoData,
  };
}
