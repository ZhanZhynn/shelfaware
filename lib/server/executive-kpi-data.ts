import prisma from "@/prisma/client";
import type { ExecutiveKpiData, KpiMetric } from "@/types/executive-kpi";
import { getFinancialCurrencyContext } from "@/lib/server/financial-currency";

function kpi(current: number, previous?: number): KpiMetric {
  const change = previous !== undefined ? current - previous : undefined;
  const changePercent = previous !== undefined && previous !== 0
    ? ((current - previous) / Math.abs(previous)) * 100
    : undefined;
  return {
    value: Math.round(current * 100) / 100,
    previousValue: previous !== undefined ? Math.round(previous * 100) / 100 : undefined,
    change: change !== undefined ? Math.round(change * 100) / 100 : undefined,
    changePercent: changePercent !== undefined ? Math.round(changePercent * 100) / 100 : undefined,
    isPositive: change !== undefined ? change >= 0 : true,
  };
}

export async function getExecutiveKpiForUser(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<ExecutiveKpiData> {
  const now = new Date();
  const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo ? new Date(dateTo) : now;
  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
  const prevFrom = new Date(from.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const prevTo = new Date(from);
  const currency = await getFinancialCurrencyContext(userId);

  const [
    wmsOrders,
    shopeeOrders,
    wmsInvoiceStats,
    shopeeFeeStats,
    products,
    shopeeProducts,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { userId, createdAt: { gte: from, lte: to } },
      select: { id: true, status: true, total: true, shipping: true, currency: true, createdAt: true, shippedAt: true, deliveredAt: true },
    }),
    prisma.shopeeOrder.findMany({
      where: { userId, shopeeCreatedAt: { gte: from, lte: to } },
      select: {
        id: true, orderStatus: true, totalAmount: true, shipByDate: true,
        shippedAt: true, commissionFee: true, serviceFee: true, sellerTxnFee: true,
        sellerIncome: true, currency: true, shopeeCreatedAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { userId, issuedAt: { gte: from, lte: to } },
      select: { status: true, total: true, amountPaid: true, currency: true, issuedAt: true, paidAt: true },
    }),
    prisma.shopeeOrderItem.findMany({
      where: {
        order: { userId, orderStatus: { not: "CANCELLED" }, shopeeCreatedAt: { gte: from, lte: to } },
      },
      select: { quantity: true, price: true, order: { select: { currency: true } } },
    }),
    prisma.product.findMany({
      where: { userId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
      select: { id: true, price: true, quantity: true },
    }),
    prisma.shopeeProduct.findMany({
      where: { userId, status: "NORMAL" },
      select: { price: true, stock: true },
    }),
  ]);

  const nonCancelledWms = wmsOrders.filter((o) => o.status !== "cancelled");
  const nonCancelledShopee = shopeeOrders.filter((o) => o.orderStatus !== "CANCELLED");
  const sum = <T>(items: T[], getAmount: (item: T) => number, getCurrency: (item: T) => string | null | undefined, legacyBaseCurrency = false) =>
    items.reduce((total, item) => total + (currency.convert(getAmount(item), getCurrency(item), legacyBaseCurrency) ?? 0), 0);
  const wmsShippedOrDelivered = nonCancelledWms.filter((o) => ["shipped", "delivered"].includes(o.status));
  const shopeeShippedOrCompleted = nonCancelledShopee.filter((o) => ["SHIPPED", "COMPLETED"].includes(o.orderStatus));
  const totalOrders = nonCancelledWms.length + nonCancelledShopee.length;
  const shippedOrders = wmsShippedOrDelivered.length + shopeeShippedOrCompleted.length;
  const fulfillmentRate = totalOrders > 0 ? (shippedOrders / totalOrders) * 100 : 0;

  const shopeeWithSla = nonCancelledShopee.filter((o) => o.shipByDate && o.shippedAt);
  const slaCompliant = shopeeWithSla.filter((o) => o.shippedAt! <= o.shipByDate!).length;
  const slaRate = shopeeWithSla.length > 0 ? (slaCompliant / shopeeWithSla.length) * 100 : 100;

  const wmsRevenue = sum(nonCancelledWms, (o) => o.total, (o) => o.currency, true);
  const shopeeRevenue = sum(nonCancelledShopee, (o) => o.totalAmount, (o) => o.currency);
  const totalRevenue = wmsRevenue + shopeeRevenue;

  const wmsInvoicePaid = wmsInvoiceStats.filter((i) => i.status === "paid");
  const totalPaid = sum(wmsInvoicePaid, (i) => i.amountPaid, (i) => i.currency, true);
  const totalOutstanding = sum(
    wmsInvoiceStats.filter((i) => ["sent", "overdue"].includes(i.status)),
    (i) => i.total - i.amountPaid,
    (i) => i.currency,
    true,
  );

  const totalExpenses = sum(
    nonCancelledShopee,
    (o) => (o.commissionFee ?? 0) + (o.serviceFee ?? 0) + (o.sellerTxnFee ?? 0),
    (o) => o.currency,
  );
  const grossProfit = totalRevenue - totalExpenses;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  const totalInventoryValue = sum(products, (p) => p.price * Number(p.quantity), () => null, true)
    // Marketplace product prices have no persisted currency, so they cannot be safely valued.
    + sum(shopeeProducts, (p) => p.price * p.stock, () => null);
  const cogs = sum(products, (p) => p.price * Number(p.quantity), () => null, true)
    + sum(shopeeFeeStats, (i) => i.price * i.quantity, (i) => i.order.currency);
  const inventoryTurnover = totalInventoryValue > 0 ? cogs / totalInventoryValue : 0;

  const dsoValues = wmsInvoicePaid
    .filter((i) => i.paidAt && i.issuedAt)
    .map((i) => Math.ceil((i.paidAt!.getTime() - i.issuedAt.getTime()) / (1000 * 60 * 60 * 24)));
  const avgDso = dsoValues.length > 0
    ? dsoValues.reduce((s, d) => s + d, 0) / dsoValues.length
    : 0;

  const cashFlow = totalPaid
    + sum(nonCancelledShopee, (o) => o.sellerIncome ?? 0, (o) => o.currency)
    - totalOutstanding;

  const includedOrderCount = nonCancelledWms.filter((o) => currency.convert(o.total, o.currency, true) !== null).length
    + nonCancelledShopee.filter((o) => currency.convert(o.totalAmount, o.currency) !== null).length;
  const avgOrderValue = includedOrderCount > 0 ? totalRevenue / includedOrderCount : 0;

  const revenueBreakdown: ExecutiveKpiData["revenueBreakdown"] = [];
  const trendStart = new Date(from);
  trendStart.setMonth(trendStart.getMonth() - 5);
  for (let i = 0; i < 6; i++) {
    const mStart = new Date(trendStart);
    mStart.setMonth(mStart.getMonth() + i);
    const mEnd = new Date(mStart);
    mEnd.setMonth(mEnd.getMonth() + 1);
    mEnd.setDate(0);
    if (mStart > to) break;
    const mWms = wmsOrders.filter((o) => o.createdAt >= mStart && o.createdAt <= mEnd && o.status !== "cancelled");
    const mShopee = shopeeOrders.filter((o) => o.shopeeCreatedAt && o.shopeeCreatedAt >= mStart && o.shopeeCreatedAt <= mEnd && o.orderStatus !== "CANCELLED");
    const mWmsRev = sum(mWms, (o) => o.total, (o) => o.currency, true);
    const mShopeeRev = sum(mShopee, (o) => o.totalAmount, (o) => o.currency);
    revenueBreakdown.push({
      period: mStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      wmsRevenue: mWmsRev,
      shopeeRevenue: mShopeeRev,
      totalRevenue: mWmsRev + mShopeeRev,
    });
  }

  const channelSplit = [
    { channel: "WMS", revenue: wmsRevenue, orders: nonCancelledWms.length, percentage: totalRevenue > 0 ? (wmsRevenue / totalRevenue) * 100 : 0 },
    { channel: "Shopee", revenue: shopeeRevenue, orders: nonCancelledShopee.length, percentage: totalRevenue > 0 ? (shopeeRevenue / totalRevenue) * 100 : 0 },
  ];

  return {
    currency: currency.metadata(),
    period: { from: from.toISOString(), to: to.toISOString() },
    comparePeriod: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
    kpis: {
      fulfillmentRate: kpi(fulfillmentRate),
      slaCompliance: kpi(slaRate),
      inventoryTurnover: kpi(inventoryTurnover),
      grossMargin: kpi(grossMargin),
      cashFlow: kpi(cashFlow),
      daysSalesOutstanding: kpi(avgDso),
      totalRevenue: kpi(totalRevenue),
      totalOrders: kpi(totalOrders),
      avgOrderValue: kpi(avgOrderValue),
    },
    revenueBreakdown,
    channelSplit,
  };
}
