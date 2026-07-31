import prisma from "@/prisma/client";
import type { PnlReport, PnlData, PnlMonthlyTrend } from "@/types/pnl";
import { getFinancialCurrencyContext } from "@/lib/server/financial-currency";
import type { AdminDataScope } from "@/lib/admin/data-scope";

interface PeriodParams {
  from: Date;
  to: Date;
  label: string;
}

function getPeriod(period?: string, dateFrom?: string, dateTo?: string): PeriodParams {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (dateFrom && dateTo) {
    return { from: new Date(dateFrom), to: new Date(dateTo), label: "Custom" };
  }

  switch (period) {
    case "last_month": {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: lastMonthStart, to: lastMonthEnd, label: "Last Month" };
    }
    case "this_quarter": {
      const quarter = Math.floor(now.getMonth() / 3);
      const qStart = new Date(now.getFullYear(), quarter * 3, 1);
      return { from: qStart, to: now, label: "This Quarter" };
    }
    case "last_quarter": {
      const prevQuarter = Math.floor(now.getMonth() / 3) - 1;
      const year = prevQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const q = prevQuarter < 0 ? 3 : prevQuarter;
      const qStart = new Date(year, q * 3, 1);
      const qEnd = new Date(year, q * 3 + 3, 0);
      return { from: qStart, to: qEnd, label: "Last Quarter" };
    }
    case "this_year": {
      return { from: new Date(now.getFullYear(), 0, 1), to: now, label: "This Year" };
    }
    default:
      return { from: startOfMonth, to: now, label: "This Month" };
  }
}

function getComparePeriod(mainPeriod: PeriodParams): PeriodParams {
  const diff = mainPeriod.to.getTime() - mainPeriod.from.getTime();
  return {
    from: new Date(mainPeriod.from.getTime() - diff),
    to: new Date(mainPeriod.to.getTime() - diff),
    label: "Previous Period",
  };
}

async function calculatePnl(
  from: Date,
  to: Date,
  currency: Awaited<ReturnType<typeof getFinancialCurrencyContext>>,
  ownerIds: string[],
): Promise<PnlData> {
  const ownerScope = { in: ownerIds };
  const [wmsOrders, shopeeOrders, wmsInvoiceStats, shopeeFeeStats, shopeeReturns, wmsReturns] =
    await Promise.all([
      prisma.order.findMany({
        where: { userId: ownerScope, status: { not: "cancelled" }, createdAt: { gte: from, lte: to } },
        select: { id: true, total: true, shipping: true, currency: true, createdAt: true },
      }),
      prisma.shopeeOrder.findMany({
        where: {
          userId: ownerScope,
          orderStatus: { not: "CANCELLED" },
          shopeeCreatedAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          totalAmount: true,
          currency: true,
          commissionFee: true,
          serviceFee: true,
          sellerTxnFee: true,
          shippingFee: true,
          shopeeCreatedAt: true,
        },
      }),
      prisma.orderItem.findMany({
        where: {
          order: { userId: ownerScope, status: { not: "cancelled" }, createdAt: { gte: from, lte: to } },
        },
        select: { productId: true, quantity: true, price: true },
      }),
      prisma.shopeeOrderItem.findMany({
        where: {
          order: {
            userId: ownerScope,
            orderStatus: { not: "CANCELLED" },
            shopeeCreatedAt: { gte: from, lte: to },
          },
        },
        select: { variantId: true, productId: true, quantity: true, price: true, order: { select: { currency: true, shopeeCreatedAt: true } } },
      }),
      prisma.shopeeReturn.findMany({
        where: {
          userId: ownerScope,
          status: "COMPLETED",
          shopeeCreatedAt: { gte: from, lte: to },
        },
        select: { refundAmount: true, currency: true, shopeeCreatedAt: true },
      }),
      prisma.order.findMany({
        where: { userId: ownerScope, paymentStatus: "refunded", createdAt: { gte: from, lte: to } },
        select: { total: true, currency: true, createdAt: true },
      }),
    ]);

  const sum = <T>(items: T[], getAmount: (item: T) => number, getCurrency: (item: T) => string | null | undefined, getOccurredAt: (item: T) => Date | null | undefined, legacyBaseCurrency = false) =>
    items.reduce((total, item) => total + (currency.convert(getAmount(item), getCurrency(item), legacyBaseCurrency, getOccurredAt(item)) ?? 0), 0);

  const wmsRevenue = sum(wmsOrders, (o) => o.total, (o) => o.currency, (o) => o.createdAt, true);
  const shopeeRevenue = sum(shopeeOrders, (o) => o.totalAmount, (o) => o.currency, (o) => o.shopeeCreatedAt);

  const productIds = [...new Set(wmsInvoiceStats.map((i) => i.productId))];
  const products = productIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, price: true },
      })
    : [];
  const productPriceMap = new Map(products.map((p) => [p.id, p.price]));

  const wmsCogs = wmsInvoiceStats.reduce((s, i) => {
    const cost = productPriceMap.get(i.productId) ?? i.price;
    return s + (currency.convert(cost * i.quantity, null, true) ?? 0);
  }, 0);

  const shopeeCogs = sum(shopeeFeeStats, (i) => i.price * i.quantity, (i) => i.order.currency, (i) => i.order.shopeeCreatedAt);

  const marketplaceFees = sum(
    shopeeOrders,
    (o) => (o.commissionFee ?? 0) + (o.serviceFee ?? 0) + (o.sellerTxnFee ?? 0),
    (o) => o.currency,
    (o) => o.shopeeCreatedAt,
  );

  const wmsShipping = sum(wmsOrders, (o) => o.shipping ?? 0, (o) => o.currency, (o) => o.createdAt, true);
  const shopeeShipping = sum(shopeeOrders, (o) => o.shippingFee ?? 0, (o) => o.currency, (o) => o.shopeeCreatedAt);

  const wmsReturnsTotal = sum(wmsReturns, (o) => o.total, (o) => o.currency, (o) => o.createdAt, true);
  // Newly observed return amounts can be unknown; never manufacture a zero refund.
  const knownShopeeReturns = shopeeReturns.filter((returnRow): returnRow is typeof returnRow & { refundAmount: number } => returnRow.refundAmount !== null);
  const shopeeReturnsTotal = sum(knownShopeeReturns, (r) => r.refundAmount, (r) => r.currency, (r) => r.shopeeCreatedAt);

  const revenue = { wms: wmsRevenue, shopee: shopeeRevenue, total: wmsRevenue + shopeeRevenue };
  const cogs = { wms: wmsCogs, shopee: shopeeCogs, total: wmsCogs + shopeeCogs };
  const grossProfit = revenue.total - cogs.total;
  const grossMargin = revenue.total > 0 ? (grossProfit / revenue.total) * 100 : 0;

  const expenses = {
    marketplaceFees,
    shippingCosts: wmsShipping + shopeeShipping,
    returns: wmsReturnsTotal + shopeeReturnsTotal,
    total: marketplaceFees + wmsShipping + shopeeShipping + wmsReturnsTotal + shopeeReturnsTotal,
  };

  const netProfit = grossProfit - expenses.total;
  const netMargin = revenue.total > 0 ? (netProfit / revenue.total) * 100 : 0;

  return {
    revenue,
    cogs,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossMargin: Math.round(grossMargin * 100) / 100,
    expenses,
    netProfit: Math.round(netProfit * 100) / 100,
    netMargin: Math.round(netMargin * 100) / 100,
  };
}

export async function getPnlForUser(
  userId: string,
  period?: string,
  dateFrom?: string,
  dateTo?: string,
  dataScope?: Pick<AdminDataScope, "ownerIds">,
): Promise<PnlReport> {
  const mainPeriod = getPeriod(period, dateFrom, dateTo);
  const comparePeriod = getComparePeriod(mainPeriod);
  const ownerIds = dataScope?.ownerIds ?? [userId];
  const currency = await getFinancialCurrencyContext(userId);

  const [current, previous] = await Promise.all([
    calculatePnl(mainPeriod.from, mainPeriod.to, currency, ownerIds),
    calculatePnl(comparePeriod.from, comparePeriod.to, currency, ownerIds),
  ]);

  const monthlyTrend: PnlMonthlyTrend[] = [];
  const trendStart = new Date(mainPeriod.from);
  trendStart.setMonth(trendStart.getMonth() - 5);

  for (let i = 0; i < 6; i++) {
    const mStart = new Date(trendStart);
    mStart.setMonth(mStart.getMonth() + i);
    const mEnd = new Date(mStart);
    mEnd.setMonth(mEnd.getMonth() + 1);
    mEnd.setDate(0);

    if (mStart > mainPeriod.to) break;

    const mPnl = await calculatePnl(mStart, mEnd, currency, ownerIds);
    monthlyTrend.push({
      month: mStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: mPnl.revenue.total,
      cogs: mPnl.cogs.total,
      grossProfit: mPnl.grossProfit,
      netProfit: mPnl.netProfit,
    });
  }

  return {
    currency: currency.metadata(),
    period: {
      from: mainPeriod.from.toISOString(),
      to: mainPeriod.to.toISOString(),
      label: mainPeriod.label,
    },
    comparePeriod: {
      from: comparePeriod.from.toISOString(),
      to: comparePeriod.to.toISOString(),
      label: comparePeriod.label,
    },
    current,
    previous,
    monthlyTrend,
  };
}
