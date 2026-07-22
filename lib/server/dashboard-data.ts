/**
 * Server-side data for admin Dashboard (Analytics) page
 * Aggregates counts, revenue, trends, and recent activity across all entities.
 * Only import from server code (e.g. app/admin/insights/page.tsx, GET /api/dashboard).
 * getDashboardForAdmin(userId) returns DashboardStats; uses Redis cache when available.
 * Supplier count includes demo supplier (getDemoSupplierUserId) so list and dashboard match.
 */

import { getCache, setCache, cacheKeys } from "@/lib/cache";
import { prisma } from "@/prisma/client";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { getDemoSupplierUserId } from "@/prisma/supplier";
import { getFinancialCurrencyContext } from "@/lib/server/financial-currency";
import type {
  DashboardStats,
  DashboardCounts,
  DashboardRevenue,
  DashboardTrendPoint,
  DashboardRecent,
  DashboardRecentOrder,
  DashboardRecentTicket,
  DashboardRecentReview,
  DashboardRecentImport,
  DashboardOrderAnalytics,
  DashboardOrderStatusDist,
  DashboardTopProduct,
  DashboardInvoiceAnalytics,
  DashboardInvoiceStatusDist,
  DashboardWarehouseAnalytics,
  DashboardProductStatusBreakdown,
  DashboardUserRoleBreakdown,
  DashboardSupplierStatusBreakdown,
  DashboardCategoryStatusBreakdown,
  DashboardTicketStatusBreakdown,
  DashboardReviewStatusBreakdown,
  DashboardSelfOthersBreakdown,
} from "@/types";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getLast12Months(): {
  year: number;
  month: number;
  key: string;
  label: string;
}[] {
  const now = new Date();
  const out: { year: number; month: number; key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const label = `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
    out.push({ year: y, month: m, key, label });
  }
  return out;
}

function getTwelveMonthsAgo(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Prisma where clause for resources owned by this user (products, categories, etc.). */
const userScope = (userId: string) => ({ userId });

/** Store-wide order IDs: self (created by userId) + client orders (contain products owned by userId). */
async function getStoreOrderIds(productOwnerUserId: string): Promise<string[]> {
  const [selfOrders, clientOrderItems] = await Promise.all([
    prisma.order.findMany({
      where: { userId: productOwnerUserId },
      select: { id: true },
    }),
    prisma.orderItem.findMany({
      where: { product: { userId: productOwnerUserId } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
  ]);
  const ids = new Set<string>();
  selfOrders.forEach((o) => ids.add(o.id));
  clientOrderItems.forEach((o) => ids.add(o.orderId));
  return Array.from(ids);
}

export async function getDashboardForAdmin(userId: string): Promise<DashboardStats> {
  const cacheKey = `${cacheKeys.dashboard.overview(userId)}:currency-v2`;
  const cached = await getCache<DashboardStats>(cacheKey);
  if (cached) return cached;

  const demoUserId = await getDemoSupplierUserId();
  const whereSuppliers =
    demoUserId != null
      ? { OR: [{ userId }, { userId: demoUserId }] }
      : userScope(userId);

  const since = getTwelveMonthsAgo();
  const whereUser = userScope(userId);
  const currency = await getFinancialCurrencyContext(userId);

  const userProductIds = (
    await prisma.product.findMany({
      where: mergeProductListWhere(whereUser),
      select: { id: true },
    })
  ).map((p) => p.id);
  const reviewWhere =
    userProductIds.length > 0
      ? { productId: { in: userProductIds } }
      : { productId: { in: [] } };

  const storeOrderIds = await getStoreOrderIds(userId);
  const whereStoreOrders = storeOrderIds.length > 0 ? { id: { in: storeOrderIds } } : { id: { in: [] } };
  const whereInvoiceForStore = storeOrderIds.length > 0 ? { orderId: { in: storeOrderIds } } : { orderId: { in: [] } };

  const selfOrderIds =
    storeOrderIds.length > 0
      ? (
          await prisma.order.findMany({
            where: { userId, id: { in: storeOrderIds } },
            select: { id: true },
          })
        ).map((o) => o.id)
      : [];

  const [
    productsCount,
    suppliersCount,
    categoriesCount,
    ordersCount,
    invoicesCount,
    warehousesCount,
    ticketsCount,
    reviewsCount,
    orderRefundedCount,
    ordersRaw,
    invoicesRaw,
    productsRaw,
    recentOrders,
    recentTickets,
    recentReviews,
    recentImports,
    orderStatusGroups,
    invoiceStatusGroups,
    activeWarehousesCount,
    inactiveWarehousesCount,
    warehouseTypeGroups,
    selfInvoiceCount,
    financialOrders,
    financialInvoices,
    topProductItems,
  ] = await Promise.all([
    prisma.product.count({ where: mergeProductListWhere(whereUser) }),
    prisma.supplier.count({ where: whereSuppliers }),
    prisma.category.count({ where: whereUser }),
    prisma.order.count({ where: whereStoreOrders }),
    prisma.invoice.count({ where: whereInvoiceForStore }),
    prisma.warehouse.count({ where: whereUser }),
    prisma.supportTicket.count({ where: { assignedToId: userId } }),
    prisma.productReview.count({ where: reviewWhere }),
    prisma.order.count({
      where: { ...whereStoreOrders, paymentStatus: "refunded" },
    }),
    prisma.order.findMany({
      where: { ...whereStoreOrders, createdAt: { gte: since } },
      select: { createdAt: true, total: true, currency: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invoice.findMany({
      where: { ...whereInvoiceForStore, createdAt: { gte: since } },
      select: { createdAt: true, total: true, currency: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      where: mergeProductListWhere({
        ...whereUser,
        createdAt: { gte: since },
      }),
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.findMany({
      where: whereStoreOrders,
      select: {
        id: true,
        orderNumber: true,
        total: true,
        currency: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.supportTicket.findMany({
      where: { assignedToId: userId },
      select: { id: true, subject: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.productReview.findMany({
      where: reviewWhere,
      select: {
        id: true,
        productName: true,
        rating: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.importHistory.findMany({
      where: whereUser,
      select: {
        id: true,
        importType: true,
        fileName: true,
        status: true,
        successRows: true,
        failedRows: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: whereStoreOrders,
      _count: { id: true },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: whereInvoiceForStore,
      _count: { id: true },
      _sum: { total: true, amountPaid: true, amountDue: true },
    }),
    prisma.warehouse.count({ where: { ...whereUser, status: true } }),
    prisma.warehouse.count({ where: { ...whereUser, status: false } }),
    prisma.warehouse.groupBy({
      by: ["type"],
      where: whereUser,
      _count: { id: true },
    }),
    selfOrderIds.length > 0
      ? prisma.invoice.count({ where: { orderId: { in: selfOrderIds } } })
      : 0,
    prisma.order.findMany({
      where: whereStoreOrders,
      select: { id: true, userId: true, status: true, paymentStatus: true, total: true, currency: true },
    }),
    prisma.invoice.findMany({
      where: whereInvoiceForStore,
      select: { status: true, total: true, amountPaid: true, amountDue: true, currency: true },
    }),
    storeOrderIds.length > 0 ? prisma.orderItem.findMany({
      where: { orderId: { in: storeOrderIds } },
      select: {
        productId: true,
        productName: true,
        sku: true,
        quantity: true,
        subtotal: true,
        order: { select: { currency: true } },
      },
    }) : [],
  ]);

  const [
    usersCount,
    userRoleGroups,
    productsForBreakdown,
    supplierActiveCount,
    supplierInactiveCount,
    categoryActiveCount,
    categoryInactiveCount,
    ticketStatusGroups,
    reviewStatusGroups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
    prisma.product.findMany({
      where: mergeProductListWhere(whereUser),
      select: { status: true, price: true, quantity: true },
    }),
    prisma.supplier.count({ where: { ...whereSuppliers, status: true } }),
    prisma.supplier.count({ where: { ...whereSuppliers, status: false } }),
    prisma.category.count({ where: { ...whereUser, status: true } }),
    prisma.category.count({ where: { ...whereUser, status: false } }),
    prisma.supportTicket.groupBy({
      by: ["status"],
      where: { assignedToId: userId },
      _count: { id: true },
    }),
    prisma.productReview.groupBy({
      by: ["status"],
      where: reviewWhere,
      _count: { id: true },
    }),
  ]);

  // ── Shopee order analytics ─────────────────────────────────────────────────
  const shopeeShops = await prisma.shopeeShop.findMany({
    where: { userId },
    select: { id: true },
  });
  const shopeeShopIds = shopeeShops.map((s) => s.id);

  let shopeeOrderAnalytics: import("@/types").DashboardShopeeOrderAnalytics | undefined;
  if (shopeeShopIds.length > 0) {
    const now = new Date();
    const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const [shopeeOrderCount, shopeeOrdersForCurrency, shopeeStatusGroups, shopeeNearSlaCount] =
      await Promise.all([
        prisma.shopeeOrder.count({
          where: { shopId: { in: shopeeShopIds } },
        }),
        prisma.shopeeOrder.findMany({
          where: { shopId: { in: shopeeShopIds } },
          select: { totalAmount: true, currency: true },
        }),
        prisma.shopeeOrder.groupBy({
          by: ["orderStatus"],
          where: { shopId: { in: shopeeShopIds } },
          _count: true,
        }),
        prisma.shopeeOrder.count({
          where: {
            shopId: { in: shopeeShopIds },
            orderStatus: { in: ["confirmed", "processing"] },
            shipByDate: { not: null, lte: deadline },
          },
        }),
      ]);

    const shopeeStatusMap: Record<string, number> = {};
    for (const s of shopeeStatusGroups) {
      shopeeStatusMap[s.orderStatus] = s._count;
    }

    const shopeeRevenue = shopeeOrdersForCurrency.reduce(
      (total, order) => total + (currency.convert(order.totalAmount, order.currency) ?? 0),
      0,
    );
    const includedShopeeOrders = shopeeOrdersForCurrency.filter(
      (order) => currency.convert(order.totalAmount, order.currency) !== null,
    ).length;
    shopeeOrderAnalytics = {
      totalOrders: shopeeOrderCount,
      totalRevenue: shopeeRevenue,
      averageOrderValue: includedShopeeOrders > 0 ? shopeeRevenue / includedShopeeOrders : 0,
      ordersByStatus: shopeeStatusMap,
      nearSlaCount: shopeeNearSlaCount,
    };
  }

  // ── Lazada order analytics ─────────────────────────────────────────────────
  const lazadaShops = await prisma.lazadaShop.findMany({
    where: { userId },
    select: { id: true },
  });
  const lazadaShopIds = lazadaShops.map((s) => s.id);

  let lazadaOrderAnalytics: import("@/types").DashboardLazadaOrderAnalytics | undefined;
  if (lazadaShopIds.length > 0) {
    const [lazadaOrderCount, lazadaOrdersForCurrency, lazadaStatusGroups] =
      await Promise.all([
        prisma.lazadaOrder.count({
          where: { shopId: { in: lazadaShopIds } },
        }),
        prisma.lazadaOrder.findMany({
          where: { shopId: { in: lazadaShopIds } },
          select: { totalAmount: true, currency: true },
        }),
        prisma.lazadaOrder.groupBy({
          by: ["orderStatus"],
          where: { shopId: { in: lazadaShopIds } },
          _count: true,
        }),
      ]);

    const lazadaStatusMap: Record<string, number> = {};
    for (const s of lazadaStatusGroups) {
      lazadaStatusMap[s.orderStatus] = s._count;
    }

    const lazadaRevenue = lazadaOrdersForCurrency.reduce(
      (total, order) => total + (currency.convert(order.totalAmount, order.currency) ?? 0),
      0,
    );
    const includedLazadaOrders = lazadaOrdersForCurrency.filter(
      (order) => currency.convert(order.totalAmount, order.currency) !== null,
    ).length;
    lazadaOrderAnalytics = {
      totalOrders: lazadaOrderCount,
      totalRevenue: lazadaRevenue,
      averageOrderValue: includedLazadaOrders > 0 ? lazadaRevenue / includedLazadaOrders : 0,
      ordersByStatus: lazadaStatusMap,
    };
  }

  const productStatusBreakdown: DashboardProductStatusBreakdown = {
    available: 0,
    stockLow: 0,
    stockOut: 0,
  };
  let totalInventoryValue = 0;
  for (const p of productsForBreakdown) {
    const status = (p.status || "").toLowerCase().replace(/\s+/g, "_");
    if (status === "available") productStatusBreakdown.available += 1;
    else if (status === "stock_low") productStatusBreakdown.stockLow += 1;
    else if (status === "stock_out") productStatusBreakdown.stockOut += 1;
    totalInventoryValue += Number(p.price ?? 0) * Number(p.quantity ?? 0);
  }

  const userRoleBreakdown: DashboardUserRoleBreakdown = {
    admin: 0,
    client: 0,
    supplier: 0,
  };
  for (const g of userRoleGroups) {
    const role = (g.role ?? "").toLowerCase();
    const count = g._count.id;
    if (role === "admin") userRoleBreakdown.admin = count;
    else if (role === "client") userRoleBreakdown.client = count;
    else if (role === "supplier") userRoleBreakdown.supplier = count;
  }

  const supplierStatusBreakdown: DashboardSupplierStatusBreakdown = {
    active: supplierActiveCount,
    inactive: supplierInactiveCount,
  };

  const categoryStatusBreakdown: DashboardCategoryStatusBreakdown = {
    active: categoryActiveCount,
    inactive: categoryInactiveCount,
  };

  const ticketStatusBreakdown: DashboardTicketStatusBreakdown = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  };
  for (const g of ticketStatusGroups) {
    const status = (g.status ?? "").toLowerCase();
    const count = g._count.id;
    if (status === "open") ticketStatusBreakdown.open = count;
    else if (status === "in_progress") ticketStatusBreakdown.in_progress = count;
    else if (status === "resolved") ticketStatusBreakdown.resolved = count;
    else if (status === "closed") ticketStatusBreakdown.closed = count;
  }

  const reviewStatusBreakdown: DashboardReviewStatusBreakdown = {
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const g of reviewStatusGroups) {
    const status = (g.status ?? "").toLowerCase();
    const count = g._count.id;
    if (status === "pending") reviewStatusBreakdown.pending = count;
    else if (status === "approved") reviewStatusBreakdown.approved = count;
    else if (status === "rejected") reviewStatusBreakdown.rejected = count;
  }

  const counts: DashboardCounts = {
    products: productsCount,
    users: usersCount,
    suppliers: suppliersCount,
    categories: categoriesCount,
    orders: ordersCount,
    invoices: invoicesCount,
    warehouses: warehousesCount,
    tickets: ticketsCount,
    reviews: reviewsCount,
  };

  // WMS records without a currency predate currency support and are in the workspace base currency.
  const orderAmount = (order: typeof financialOrders[number]) =>
    currency.convert(order.total, order.currency, true) ?? 0;
  const invoiceAmount = (invoice: typeof financialInvoices[number], amount: number) =>
    currency.convert(amount, invoice.currency, true) ?? 0;
  const sumOrders = (predicate: (order: typeof financialOrders[number]) => boolean) =>
    financialOrders.filter(predicate).reduce((total, order) => total + orderAmount(order), 0);
  const sumInvoices = (
    predicate: (invoice: typeof financialInvoices[number]) => boolean,
    amount: (invoice: typeof financialInvoices[number]) => number,
  ) => financialInvoices.filter(predicate).reduce((total, invoice) => total + invoiceAmount(invoice, amount(invoice)), 0);

  const revenue: DashboardRevenue = {
    fromOrders: sumOrders(() => true),
    fromInvoices: sumInvoices(() => true, (invoice) => invoice.total),
  };

  const months = getLast12Months();
  const orderByMonth = new Map<string, { count: number; sum: number }>();
  const invoiceByMonth = new Map<string, { count: number; sum: number }>();
  const productByMonth = new Map<string, number>();

  for (const m of months) {
    orderByMonth.set(m.key, { count: 0, sum: 0 });
    invoiceByMonth.set(m.key, { count: 0, sum: 0 });
    productByMonth.set(m.key, 0);
  }

  for (const o of ordersRaw) {
    if ("status" in o && o.status === "cancelled") continue;
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = orderByMonth.get(key);
    if (cur) {
      cur.count += 1;
      cur.sum += currency.convert(o.total, o.currency, true) ?? 0;
    }
  }
  for (const inv of invoicesRaw) {
    const d = new Date(inv.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = invoiceByMonth.get(key);
    if (cur) {
      cur.count += 1;
      cur.sum += currency.convert(inv.total, inv.currency, true) ?? 0;
    }
  }
  for (const p of productsRaw) {
    const d = new Date(p.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = productByMonth.get(key) ?? 0;
    productByMonth.set(key, cur + 1);
  }

  const trends: DashboardTrendPoint[] = months.map((m) => {
    const o = orderByMonth.get(m.key);
    const i = invoiceByMonth.get(m.key);
    const p = productByMonth.get(m.key) ?? 0;
    return {
      month: m.key,
      label: m.label,
      orders: o?.count ?? 0,
      revenue: o?.sum ?? 0,
      products: p,
      invoices: i?.count ?? 0,
    };
  });

  const recent: DashboardRecent = {
    orders: recentOrders.map(
      (o): DashboardRecentOrder => ({
        id: o.id,
        orderNumber: o.orderNumber,
        total: Number(o.total),
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      }),
    ),
    tickets: recentTickets.map(
      (t): DashboardRecentTicket => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      }),
    ),
    reviews: recentReviews.map(
      (r): DashboardRecentReview => ({
        id: r.id,
        productName: r.productName,
        rating: r.rating,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    imports: recentImports.map(
      (im): DashboardRecentImport => ({
        id: im.id,
        importType: im.importType,
        fileName: im.fileName,
        status: im.status,
        successRows: im.successRows,
        failedRows: im.failedRows,
        createdAt: im.createdAt.toISOString(),
      }),
    ),
  };

  // Build order status distribution
  const statusDistribution: DashboardOrderStatusDist = {
    pending: 0,
    confirmed: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const g of orderStatusGroups) {
    const status = g.status as keyof DashboardOrderStatusDist;
    if (status in statusDistribution) {
      statusDistribution[status] = g._count.id;
    }
  }

  // Build top products
  const topProductsById = new Map<string, DashboardTopProduct>();
  for (const item of topProductItems) {
    const current = topProductsById.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      orderCount: 0,
      totalQuantity: 0,
      totalRevenue: 0,
    };
    current.orderCount += 1;
    current.totalQuantity += item.quantity;
    current.totalRevenue += currency.convert(item.subtotal, item.order.currency, true) ?? 0;
    topProductsById.set(item.productId, current);
  }
  const topProducts = [...topProductsById.values()]
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10);

  const totalOrderRevenue = sumOrders(() => true);
  const includedOrders = financialOrders.filter((order) => currency.convert(order.total, order.currency, true) !== null).length;
  const averageOrderValue = includedOrders > 0 ? totalOrderRevenue / includedOrders : 0;

  const totalRevenueExcludingCancelled = sumOrders((order) => order.status !== "cancelled");
  const pendingOrderAmount = sumOrders((order) => order.status !== "cancelled" && ["unpaid", "partial"].includes(order.paymentStatus));
  const paidOrderAmount = sumOrders((order) => order.status !== "cancelled" && order.paymentStatus === "paid");

  const orderAnalytics: DashboardOrderAnalytics = {
    statusDistribution,
    topProducts,
    averageOrderValue,
    totalRevenue: totalOrderRevenue,
    totalRevenueExcludingCancelled,
    pendingOrderAmount,
    paidOrderAmount,
    refundedAmount: sumOrders((order) => order.paymentStatus === "refunded"),
    refundedCount: orderRefundedCount,
    cancelledOrderAmount: sumOrders((order) => order.status === "cancelled"),
  };

  // Build invoice status distribution and analytics
  const invoiceStatusDistribution: DashboardInvoiceStatusDist = {
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
  };
  let paidRevenue = 0;
  let outstandingAmount = 0;
  let overdueAmount = 0;
  let cancelledInvoiceSum = 0;

  for (const g of invoiceStatusGroups) {
    const status = g.status as keyof DashboardInvoiceStatusDist;
    if (status in invoiceStatusDistribution) {
      invoiceStatusDistribution[status] = g._count.id;
    }
  }

  paidRevenue = sumInvoices((invoice) => invoice.status === "paid", (invoice) => invoice.total);
  overdueAmount = sumInvoices((invoice) => invoice.status === "overdue", (invoice) => invoice.amountDue);
  outstandingAmount = sumInvoices((invoice) => ["overdue", "sent", "draft"].includes(invoice.status), (invoice) => invoice.amountDue);
  cancelledInvoiceSum = sumInvoices((invoice) => invoice.status === "cancelled", (invoice) => invoice.total);

  const totalInvoiceRevenue = sumInvoices(() => true, (invoice) => invoice.total);
  const totalExcludingCancelled = totalInvoiceRevenue - cancelledInvoiceSum;
  const includedInvoiceCount = financialInvoices.filter(
    (invoice) => currency.convert(invoice.total, invoice.currency, true) !== null,
  ).length;
  const averageInvoiceValue = includedInvoiceCount > 0 ? totalInvoiceRevenue / includedInvoiceCount : 0;
  const nonCancelledCount = financialInvoices.filter(
    (invoice) => invoice.status !== "cancelled" && currency.convert(invoice.total, invoice.currency, true) !== null,
  ).length;
  const avgExcludingCancelled =
    nonCancelledCount > 0 ? totalExcludingCancelled / nonCancelledCount : 0;

  const invoiceAnalytics: DashboardInvoiceAnalytics = {
    statusDistribution: invoiceStatusDistribution,
    totalRevenue: totalInvoiceRevenue,
    totalExcludingCancelled,
    cancelledInvoiceSum,
    paidRevenue,
    outstandingAmount,
    overdueAmount,
    averageInvoiceValue,
    averageInvoiceValueExcludingCancelled: avgExcludingCancelled,
  };

  // Build warehouse analytics
  const warehouseTypeDistribution = warehouseTypeGroups.map((g) => ({
    type: g.type || "(Unspecified)",
    count: g._count.id,
  }));

  const warehouseAnalytics: DashboardWarehouseAnalytics = {
    totalWarehouses: warehousesCount,
    activeWarehouses: activeWarehousesCount,
    inactiveWarehouses: inactiveWarehousesCount,
    typeDistribution: warehouseTypeDistribution,
  };

  const selfOrderCount = selfOrderIds.length;
  const revenueSelf = sumOrders((order) => order.userId === userId && order.status !== "cancelled");
  const selfOthersBreakdown: DashboardSelfOthersBreakdown = {
    orderSelfCount: selfOrderCount,
    orderOthersCount: ordersCount - selfOrderCount,
    invoiceSelfCount: typeof selfInvoiceCount === "number" ? selfInvoiceCount : 0,
    invoiceOthersCount: invoicesCount - (typeof selfInvoiceCount === "number" ? selfInvoiceCount : 0),
    revenueSelf,
    revenueOthers: totalRevenueExcludingCancelled - revenueSelf,
  };

  const result: DashboardStats = {
    currency: currency.metadata(),
    counts,
    revenue,
    trends,
    recent,
    orderAnalytics,
    invoiceAnalytics,
    warehouseAnalytics,
    totalInventoryValue,
    productStatusBreakdown,
    userRoleBreakdown,
    supplierStatusBreakdown,
    categoryStatusBreakdown,
    ticketStatusBreakdown,
    reviewStatusBreakdown,
    selfOthersBreakdown,
    shopeeOrderAnalytics,
    lazadaOrderAnalytics,
  };
  await setCache(cacheKey, result, 300);
  return result;
}
