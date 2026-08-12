import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceCapabilities, getMarketplaceFinancialReadiness } from "./capabilities";
import { isFinancialAnalyticsEligible, parseAnalyticsDateRange } from "./server";
import type { MarketplacePlatform } from "./types";

// ── Response types ──────────────────────────────────────────────────────────

export type ProfitDetailSummary = {
  totalRevenue: number;
  totalFees: number;
  totalShipping: number;
  sellerIncome: number;
  overallMargin: number;
  totalOrders: number;
  avgOrderValue: number;
  avgFeePerOrder: number;
};

export type FeeBreakdownItem = {
  name: string;
  amount: number;
  percentage: number;
};

export type ProductProfitRow = {
  productName: string;
  revenue: number;
  quantitySold: number;
  orderCount: number;
  estimatedFees: number;
  estimatedProfit: number;
  margin: number;
};

export type ShippingDiscrepancySummary = {
  totalOrders: number;
  ordersWithDiscrepancy: number;
  totalEstimated: number;
  totalActual: number;
  totalDiscrepancy: number;
};

export type ShippingDiscrepancyProduct = {
  productName: string;
  orderCount: number;
  totalEstimated: number;
  totalActual: number;
  avgDiscrepancy: number;
  discrepancyPct: number;
  totalRevenue: number;
  totalQuantity: number;
};

export type ProfitDetailResponse = {
  summary: ProfitDetailSummary;
  feeBreakdown: FeeBreakdownItem[];
  byProduct: ProductProfitRow[];
  shippingDiscrepancy?: {
    summary: ShippingDiscrepancySummary;
    products: ShippingDiscrepancyProduct[];
  };
  coverage: { state: "ready" | "provisional" | "unavailable"; basis: string; exclusions: string[] };
  currency: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const round = (v: number) => Math.round(v * 100) / 100;

type Session = Parameters<typeof marketplaceOwnerIds>[0];

function fallbackDateFilter(field: string, range?: { gte?: Date; lte?: Date }) {
  return range ? { OR: [{ [field]: range }, { [field]: null, createdAt: range }] } : {};
}

/** Proportional fee allocation: each product's share of total fees by revenue. */
function allocateFeesByRevenue(
  products: Map<string, { revenue: number }>,
  totalFees: number,
): Map<string, number> {
  const totalRevenue = [...products.values()].reduce((s, p) => s + p.revenue, 0);
  const result = new Map<string, number>();
  if (totalRevenue <= 0) return result;
  for (const [name, p] of products) {
    result.set(name, round((p.revenue / totalRevenue) * totalFees));
  }
  return result;
}

/** Parse a money value from a rawPayload field (string or number). */
function parseMoneyStringFromPayload(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ── Shopee ──────────────────────────────────────────────────────────────────

async function getShopeeProfitDetail(
  ownerIds: string[],
  shopIds: string[],
  range?: { gte?: Date; lte?: Date },
): Promise<ProfitDetailResponse> {
  const orders = await prisma.shopeeOrder.findMany({
    where: { shopId: { in: shopIds }, ...fallbackDateFilter("shopeeCreatedAt", range) },
    include: { items: true },
  });

  const nonCancelled = orders.filter((o) => !/cancel|fail/i.test(o.orderStatus));
  const currency = orders[0]?.currency ?? "MYR";

  // Aggregate totals
  let totalRevenue = 0;
  let totalCommission = 0;
  let totalServiceFee = 0;
  let totalSellerTxnFee = 0;
  let totalShipping = 0;
  let totalSellerIncome = 0;
  let totalEstimatedShipping = 0;
  let hasAnyFee = false;

  for (const o of nonCancelled) {
    totalRevenue += o.totalAmount ?? 0;
    if (o.commissionFee != null) { totalCommission += o.commissionFee; hasAnyFee = true; }
    if (o.serviceFee != null) { totalServiceFee += o.serviceFee; hasAnyFee = true; }
    if (o.sellerTxnFee != null) { totalSellerTxnFee += o.sellerTxnFee; hasAnyFee = true; }
    if (o.shippingFee != null) totalShipping += o.shippingFee;
    if (o.sellerIncome != null) totalSellerIncome += o.sellerIncome;
    if (o.estimatedShippingFee != null) totalEstimatedShipping += o.estimatedShippingFee;
  }

  const totalFees = totalCommission + totalServiceFee + totalSellerTxnFee;
  const sellerIncome = hasAnyFee ? totalSellerIncome : totalRevenue - totalShipping - totalFees;

  // Fee breakdown
  const feeBreakdown: FeeBreakdownItem[] = [
    { name: "Commission Fee", amount: round(totalCommission), percentage: totalRevenue > 0 ? round((totalCommission / totalRevenue) * 100) : 0 },
    { name: "Service Fee", amount: round(totalServiceFee), percentage: totalRevenue > 0 ? round((totalServiceFee / totalRevenue) * 100) : 0 },
    { name: "Seller Transaction Fee", amount: round(totalSellerTxnFee), percentage: totalRevenue > 0 ? round((totalSellerTxnFee / totalRevenue) * 100) : 0 },
    { name: "Shipping Fee", amount: round(totalShipping), percentage: totalRevenue > 0 ? round((totalShipping / totalRevenue) * 100) : 0 },
  ].filter((f) => f.amount !== 0);

  // Per-product aggregation
  const productMap = new Map<string, { revenue: number; quantity: number; orders: Set<string> }>();
  for (const o of nonCancelled) {
    for (const item of o.items) {
      const name = item.productName || "Unknown Product";
      const existing = productMap.get(name) ?? { revenue: 0, quantity: 0, orders: new Set() };
      existing.revenue += item.subtotal ?? 0;
      existing.quantity += item.quantity;
      existing.orders.add(o.id);
      productMap.set(name, existing);
    }
  }

  const feesByProduct = allocateFeesByRevenue(productMap, totalFees);
  const byProduct: ProductProfitRow[] = [...productMap.entries()]
    .map(([name, p]) => {
      const fees = feesByProduct.get(name) ?? 0;
      const profit = round(p.revenue - fees);
      return {
        productName: name,
        revenue: round(p.revenue),
        quantitySold: p.quantity,
        orderCount: p.orders.size,
        estimatedFees: fees,
        estimatedProfit: profit,
        margin: p.revenue > 0 ? round((profit / p.revenue) * 100) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Shipping discrepancy
  const productShipping = new Map<string, { orderCount: number; totalEstimated: number; totalActual: number; totalRevenue: number; totalQuantity: number }>();
  let ordersWithDiscrepancy = 0;
  let globalEstimated = 0;
  let globalActual = 0;
  let discrepancyOrders = 0;

  for (const o of nonCancelled) {
    const estimated = o.estimatedShippingFee ?? 0;
    const actual = o.shippingFee ?? 0;
    if (estimated === 0 && actual === 0) continue;
    globalEstimated += estimated;
    globalActual += actual;
    discrepancyOrders++;
    const pct = estimated > 0 ? Math.abs((actual - estimated) / estimated) * 100 : 0;
    if (pct > 10) ordersWithDiscrepancy++;

    for (const item of o.items) {
      const name = item.productName || "Unknown Product";
      const existing = productShipping.get(name) ?? { orderCount: 0, totalEstimated: 0, totalActual: 0, totalRevenue: 0, totalQuantity: 0 };
      existing.orderCount++;
      existing.totalEstimated += estimated;
      existing.totalActual += actual;
      existing.totalRevenue += item.subtotal ?? 0;
      existing.totalQuantity += item.quantity;
      productShipping.set(name, existing);
    }
  }

  const shippingProducts: ShippingDiscrepancyProduct[] = [...productShipping.entries()]
    .map(([productName, d]) => ({
      productName,
      orderCount: d.orderCount,
      totalEstimated: round(d.totalEstimated),
      totalActual: round(d.totalActual),
      avgDiscrepancy: d.orderCount > 0 ? round((d.totalActual - d.totalEstimated) / d.orderCount) : 0,
      discrepancyPct: d.totalEstimated > 0 ? round(((d.totalActual - d.totalEstimated) / d.totalEstimated) * 100) : 0,
      totalRevenue: round(d.totalRevenue),
      totalQuantity: d.totalQuantity,
    }))
    .sort((a, b) => Math.abs(b.avgDiscrepancy) - Math.abs(a.avgDiscrepancy));

  const shippingDiscrepancy = discrepancyOrders > 0
    ? {
        summary: {
          totalOrders: discrepancyOrders,
          ordersWithDiscrepancy,
          totalEstimated: round(globalEstimated),
          totalActual: round(globalActual),
          totalDiscrepancy: round(globalActual - globalEstimated),
        },
        products: shippingProducts,
      }
    : undefined;

  const margin = totalRevenue > 0 ? round((sellerIncome / totalRevenue) * 100) : 0;
  return {
    summary: {
      totalRevenue: round(totalRevenue),
      totalFees: round(totalFees),
      totalShipping: round(totalShipping),
      sellerIncome: round(sellerIncome),
      overallMargin: margin,
      totalOrders: nonCancelled.length,
      avgOrderValue: nonCancelled.length > 0 ? round(totalRevenue / nonCancelled.length) : 0,
      avgFeePerOrder: nonCancelled.length > 0 ? round(totalFees / nonCancelled.length) : 0,
    },
    feeBreakdown,
    byProduct,
    shippingDiscrepancy,
    coverage: { state: "ready", basis: "order-estimate", exclusions: ["COGS", "advertising", "payroll", "overhead"] },
    currency,
  };
}

// ── Lazada ──────────────────────────────────────────────────────────────────

async function getLazadaProfitDetail(
  ownerIds: string[],
  shopIds: string[],
  range?: { gte?: Date; lte?: Date },
): Promise<ProfitDetailResponse> {
  const [records, orders] = await Promise.all([
    prisma.marketplaceFinancialRecord.findMany({
      where: { platform: "lazada", shopId: { in: shopIds }, ...(range ? { occurredAt: range } : {}) },
    }),
    prisma.lazadaOrder.findMany({
      where: { shopId: { in: shopIds }, ...fallbackDateFilter("lazadaCreatedAt", range) },
      include: { items: true },
    }),
  ]);

  const currency = records[0]?.currency ?? orders[0]?.currency ?? "MYR";

  // Group financial records by feeName for the donut chart
  const feeByName = new Map<string, number>();
  let totalRevenue = 0;
  let totalFees = 0;
  let totalShipping = 0;

  for (const r of records) {
    if (!r.amountMinor) continue;
    // Skip logistics fee and shipping comparison records from fee breakdown
    const txType = (r.transactionType ?? "").toLowerCase();
    if (txType === "logistics_fee" || txType === "shipping_fee_comparison") continue;

    const amount = Number(r.amountMinor) / Math.pow(10, r.amountScale);
    if (!Number.isFinite(amount)) continue;

    const feeName = r.feeName ?? r.transactionType ?? "Other";
    const type = (r.transactionType ?? "").toLowerCase();

    if (type.includes("sales")) {
      if (amount > 0) totalRevenue += amount;
      else if (amount < 0) { feeByName.set("Refunds", (feeByName.get("Refunds") ?? 0) + Math.abs(amount)); totalFees += Math.abs(amount); }
    } else if (type.includes("logistics")) {
      totalShipping += Math.abs(amount);
      feeByName.set(feeName, (feeByName.get(feeName) ?? 0) + amount);
    } else if (type.includes("fee") || type.includes("marketing")) {
      const absAmount = Math.abs(amount);
      totalFees += absAmount;
      feeByName.set(feeName, (feeByName.get(feeName) ?? 0) + absAmount);
    } else {
      feeByName.set(feeName, (feeByName.get(feeName) ?? 0) + amount);
    }
  }

  const feeBreakdown: FeeBreakdownItem[] = [...feeByName.entries()]
    .filter(([, v]) => v !== 0)
    .map(([name, amount]) => ({
      name,
      amount: round(amount),
      percentage: totalRevenue > 0 ? round((Math.abs(amount) / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Per-product: attribute via seller_sku on financial records
  const nonCancelled = orders.filter((o) => !/cancel|fail/i.test(o.orderStatus));
  const skuToProduct = new Map<string, string>();
  for (const o of nonCancelled) {
    for (const item of o.items) {
      if (item.sellerSku) skuToProduct.set(item.sellerSku, item.productName || "Unknown Product");
    }
  }

  const productRevenue = new Map<string, { revenue: number; quantity: number; orders: Set<string> }>();
  for (const o of nonCancelled) {
    for (const item of o.items) {
      const name = item.productName || "Unknown Product";
      const existing = productRevenue.get(name) ?? { revenue: 0, quantity: 0, orders: new Set() };
      existing.revenue += item.paidPrice ?? (item.price != null && item.quantity != null ? item.price * item.quantity : 0);
      existing.quantity += item.quantity ?? 0;
      existing.orders.add(o.id);
      productRevenue.set(name, existing);
    }
  }

  // Direct-attribute fees by seller_sku from financial records
  const feesByProduct = new Map<string, number>();
  for (const r of records) {
    if (!r.amountMinor || !r.itemExternalId) continue;
    const amount = Math.abs(Number(r.amountMinor) / Math.pow(10, r.amountScale));
    if (!Number.isFinite(amount) || amount === 0) continue;
    // Try to find the product via itemExternalId
    const sku = r.itemExternalId;
    const productName = skuToProduct.get(sku);
    if (productName) {
      feesByProduct.set(productName, (feesByProduct.get(productName) ?? 0) + amount);
    }
  }

  // Fallback: proportional allocation for products without direct fee attribution
  if (feesByProduct.size === 0 && totalFees > 0) {
    for (const [name, p] of productRevenue) {
      const share = totalRevenue > 0 ? (p.revenue / totalRevenue) * totalFees : 0;
      feesByProduct.set(name, share);
    }
  }

  const byProduct: ProductProfitRow[] = [...productRevenue.entries()]
    .map(([name, p]) => {
      const fees = feesByProduct.get(name) ?? 0;
      const profit = round(p.revenue - fees);
      return {
        productName: name,
        revenue: round(p.revenue),
        quantitySold: p.quantity,
        orderCount: p.orders.size,
        estimatedFees: round(fees),
        estimatedProfit: profit,
        margin: p.revenue > 0 ? round((profit / p.revenue) * 100) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const sellerIncome = totalRevenue - totalFees - totalShipping;
  const margin = totalRevenue > 0 ? round((sellerIncome / totalRevenue) * 100) : 0;

  // Shipping discrepancy: compare order-level shippingFee (customer-paid estimate)
  // with logistics_fee records (actual seller cost) per order.
  const logisticsFeeRecords = records.filter((r) => r.transactionType === "logistics_fee");
  const orderShippingFee = new Map<string, number>(); // orderExternalId → estimated shipping fee
  for (const o of nonCancelled) {
    if (o.shippingFee != null && o.shippingFee > 0) {
      orderShippingFee.set(o.lazadaOrderId, o.shippingFee);
    }
  }
  const actualByOrder = new Map<string, number>(); // orderExternalId → total actual shipping
  for (const r of logisticsFeeRecords) {
    if (!r.orderExternalId) continue;
    const raw = r.rawPayload as Record<string, unknown> | null;
    const amount = typeof raw?.amount === "number" ? raw.amount : (r.amountMinor ? Number(r.amountMinor) / Math.pow(10, r.amountScale) : 0);
    if (!Number.isFinite(amount)) continue;
    actualByOrder.set(r.orderExternalId, (actualByOrder.get(r.orderExternalId) ?? 0) + amount);
  }

  // Build per-product shipping discrepancy from orders that have both estimated and actual
  const productShipping = new Map<string, { orderCount: number; totalEstimated: number; totalActual: number; totalRevenue: number; totalQuantity: number }>();
  let discrepancyOrders = 0;
  let ordersWithDiscrepancy = 0;
  let globalEstimated = 0;
  let globalActual = 0;

  const orderItemsByExternalId = new Map<string, Array<{ productName: string; revenue: number; quantity: number }>>();
  for (const o of nonCancelled) {
    orderItemsByExternalId.set(o.lazadaOrderId, o.items.map((item) => ({
      productName: item.productName || "Unknown Product",
      revenue: item.paidPrice ?? (item.price != null && item.quantity != null ? item.price * item.quantity : 0),
      quantity: item.quantity ?? 0,
    })));
  }

  // Include orders with actual logistics fees (even if estimated is 0)
  for (const [orderId, actual] of actualByOrder) {
    const estimated = orderShippingFee.get(orderId) ?? 0;
    if (estimated === 0 && actual === 0) continue;

    discrepancyOrders++;
    globalEstimated += estimated;
    globalActual += actual;
    const pct = estimated > 0 ? Math.abs((actual - estimated) / estimated) * 100 : 0;
    if (pct > 10) ordersWithDiscrepancy++;

    const orderItems = orderItemsByExternalId.get(orderId) ?? [];
    if (orderItems.length === 0) {
      const name = "Unknown Product";
      const existing = productShipping.get(name) ?? { orderCount: 0, totalEstimated: 0, totalActual: 0, totalRevenue: 0, totalQuantity: 0 };
      existing.orderCount++;
      existing.totalEstimated += estimated;
      existing.totalActual += actual;
      productShipping.set(name, existing);
    } else {
      const totalItemRevenue = orderItems.reduce((sum, item) => sum + item.revenue, 0);
      for (const item of orderItems) {
        const share = totalItemRevenue > 0 ? item.revenue / totalItemRevenue : 1 / orderItems.length;
        const name = item.productName;
        const existing = productShipping.get(name) ?? { orderCount: 0, totalEstimated: 0, totalActual: 0, totalRevenue: 0, totalQuantity: 0 };
        existing.orderCount++;
        existing.totalEstimated += estimated * share;
        existing.totalActual += actual * share;
        existing.totalRevenue += item.revenue;
        existing.totalQuantity += item.quantity;
        productShipping.set(name, existing);
      }
    }
  }

  const shippingDiscrepancy = discrepancyOrders > 0
    ? {
        summary: {
          totalOrders: discrepancyOrders,
          ordersWithDiscrepancy,
          totalEstimated: round(globalEstimated),
          totalActual: round(globalActual),
          totalDiscrepancy: round(globalActual - globalEstimated),
        },
        products: [...productShipping.entries()]
          .map(([productName, d]) => ({
            productName,
            orderCount: d.orderCount,
            totalEstimated: round(d.totalEstimated),
            totalActual: round(d.totalActual),
            avgDiscrepancy: d.orderCount > 0 ? round((d.totalActual - d.totalEstimated) / d.orderCount) : 0,
            discrepancyPct: d.totalEstimated > 0 ? round(((d.totalActual - d.totalEstimated) / d.totalEstimated) * 100) : 0,
            totalRevenue: round(d.totalRevenue),
            totalQuantity: d.totalQuantity,
          }))
          .sort((a, b) => Math.abs(b.avgDiscrepancy) - Math.abs(a.avgDiscrepancy)),
      }
    : undefined;

  return {
    summary: {
      totalRevenue: round(totalRevenue),
      totalFees: round(totalFees),
      totalShipping: round(totalShipping),
      sellerIncome: round(sellerIncome),
      overallMargin: margin,
      totalOrders: nonCancelled.length,
      avgOrderValue: nonCancelled.length > 0 ? round(totalRevenue / nonCancelled.length) : 0,
      avgFeePerOrder: nonCancelled.length > 0 ? round(totalFees / nonCancelled.length) : 0,
    },
    feeBreakdown,
    byProduct,
    shippingDiscrepancy,
    coverage: { state: "ready", basis: "imported-records", exclusions: ["COGS", "advertising", "payroll", "overhead"] },
    currency,
  };
}

// ── TikTok ──────────────────────────────────────────────────────────────────

type TikTokTransactionPayload = {
  revenue_amount?: string;
  fee_and_tax_amount?: string;
  shipping_cost_amount?: string;
  settlement_amount?: string;
  transaction?: {
    revenue_amount?: string;
    fee_tax_amount?: string;
    settlement_amount?: string;
    quantity?: number;
    product_name?: string;
    sku_id?: string;
    revenue_breakdown?: { subtotal_before_discount_amount?: string; seller_discount_amount?: string };
    shipping_cost_breakdown?: { actual_shipping_fee_amount?: string; customer_paid_shipping_fee_amount?: string };
    fee_tax_breakdown?: {
      fee?: {
        platform_commission_amount?: string;
        transaction_fee_amount?: string;
        referral_fee_amount?: string;
        credit_card_handling_fee_amount?: string;
      };
    };
  };
};

function parseMoney(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getTikTokProfitDetail(
  ownerIds: string[],
  shopIds: string[],
  range?: { gte?: Date; lte?: Date },
): Promise<ProfitDetailResponse> {
  const records = await prisma.marketplaceFinancialRecord.findMany({
    where: { platform: "tiktok", shopId: { in: shopIds }, ...(range ? { occurredAt: range } : {}) },
  });

  const currency = records[0]?.currency ?? "MYR";

  let totalRevenue = 0;
  let totalFees = 0;
  let totalShipping = 0;
  let totalSettlement = 0;

  // Aggregate from rawPayload
  const feeByName = new Map<string, number>();
  const productMap = new Map<string, { revenue: number; fees: number; quantity: number; orders: Set<string>; settlement: number }>();

  for (const r of records) {
    const payload = r.rawPayload as TikTokTransactionPayload | null;
    if (!payload) continue;

    const revenue = parseMoney(payload.revenue_amount);
    const fees = parseMoney(payload.fee_and_tax_amount);
    const shipping = parseMoney(payload.shipping_cost_amount);
    const settlement = parseMoney(payload.settlement_amount);

    totalRevenue += revenue;
    totalFees += Math.abs(fees);
    totalShipping += Math.abs(shipping);
    totalSettlement += settlement;

    // Fee breakdown from transaction payload
    const txn = payload.transaction;
    if (txn?.fee_tax_breakdown?.fee) {
      const f = txn.fee_tax_breakdown.fee;
      const platformCommission = parseMoney(f.platform_commission_amount);
      const transactionFee = parseMoney(f.transaction_fee_amount);
      const referralFee = parseMoney(f.referral_fee_amount);
      const ccFee = parseMoney(f.credit_card_handling_fee_amount);

      if (platformCommission > 0) feeByName.set("Platform Commission", (feeByName.get("Platform Commission") ?? 0) + platformCommission);
      if (transactionFee > 0) feeByName.set("Transaction Fee", (feeByName.get("Transaction Fee") ?? 0) + transactionFee);
      if (referralFee > 0) feeByName.set("Referral Fee", (feeByName.get("Referral Fee") ?? 0) + referralFee);
      if (ccFee > 0) feeByName.set("Credit Card Handling Fee", (feeByName.get("Credit Card Handling Fee") ?? 0) + ccFee);
    }

    // Shipping breakdown
    if (txn?.shipping_cost_breakdown) {
      const actual = parseMoney(txn.shipping_cost_breakdown.actual_shipping_fee_amount);
      const customerPaid = parseMoney(txn.shipping_cost_breakdown.customer_paid_shipping_fee_amount);
      if (actual > 0) feeByName.set("Actual Shipping Fee", (feeByName.get("Actual Shipping Fee") ?? 0) + actual);
      if (customerPaid > 0) feeByName.set("Customer Paid Shipping", (feeByName.get("Customer Paid Shipping") ?? 0) + customerPaid);
    }

    // Per-SKU product data
    if (txn?.product_name) {
      const name = txn.product_name;
      const existing = productMap.get(name) ?? { revenue: 0, fees: 0, quantity: 0, orders: new Set(), settlement: 0 };
      existing.revenue += parseMoney(txn.revenue_amount);
      existing.fees += Math.abs(parseMoney(txn.fee_tax_amount));
      existing.quantity += txn.quantity ?? 0;
      existing.orders.add(r.orderExternalId ?? r.id);
      existing.settlement += parseMoney(txn.settlement_amount);
      productMap.set(name, existing);
    }
  }

  // If no transaction-level product data, aggregate from financial records only
  if (productMap.size === 0) {
    for (const r of records) {
      const payload = r.rawPayload as TikTokTransactionPayload | null;
      const name = r.feeName ?? "Settlement";
      const existing = productMap.get(name) ?? { revenue: 0, fees: 0, quantity: 0, orders: new Set(), settlement: 0 };
      existing.revenue += parseMoney(payload?.revenue_amount);
      existing.fees += Math.abs(parseMoney(payload?.fee_and_tax_amount));
      existing.orders.add(r.orderExternalId ?? r.id);
      existing.settlement += parseMoney(payload?.settlement_amount);
      productMap.set(name, existing);
    }
  }

  const feeBreakdown: FeeBreakdownItem[] = [...feeByName.entries()]
    .filter(([, v]) => v > 0)
    .map(([name, amount]) => ({
      name,
      amount: round(amount),
      percentage: totalRevenue > 0 ? round((amount / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const byProduct: ProductProfitRow[] = [...productMap.entries()]
    .map(([name, p]) => ({
      productName: name,
      revenue: round(p.revenue),
      quantitySold: p.quantity,
      orderCount: p.orders.size,
      estimatedFees: round(p.fees),
      estimatedProfit: round(p.settlement),
      margin: p.revenue > 0 ? round((p.settlement / p.revenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Shipping discrepancy from rawPayload
  const productShipping = new Map<string, { orderCount: number; totalEstimated: number; totalActual: number; totalRevenue: number; totalQuantity: number }>();
  let discrepancyOrders = 0;
  let ordersWithDiscrepancy = 0;
  let globalEstimated = 0;
  let globalActual = 0;

  for (const r of records) {
    const payload = r.rawPayload as TikTokTransactionPayload | null;
    const txn = payload?.transaction;
    if (!txn?.shipping_cost_breakdown) continue;

    const estimated = parseMoney(txn.shipping_cost_breakdown.customer_paid_shipping_fee_amount);
    const actual = parseMoney(txn.shipping_cost_breakdown.actual_shipping_fee_amount);
    if (estimated === 0 && actual === 0) continue;

    discrepancyOrders++;
    globalEstimated += estimated;
    globalActual += actual;
    const pct = estimated > 0 ? Math.abs((actual - estimated) / estimated) * 100 : 0;
    if (pct > 10) ordersWithDiscrepancy++;

    const name = txn.product_name ?? "Unknown Product";
    const existing = productShipping.get(name) ?? { orderCount: 0, totalEstimated: 0, totalActual: 0, totalRevenue: 0, totalQuantity: 0 };
    existing.orderCount++;
    existing.totalEstimated += estimated;
    existing.totalActual += actual;
    existing.totalRevenue += parseMoney(txn.revenue_amount);
    existing.totalQuantity += txn.quantity ?? 0;
    productShipping.set(name, existing);
  }

  const shippingDiscrepancy = discrepancyOrders > 0
    ? {
        summary: {
          totalOrders: discrepancyOrders,
          ordersWithDiscrepancy,
          totalEstimated: round(globalEstimated),
          totalActual: round(globalActual),
          totalDiscrepancy: round(globalActual - globalEstimated),
        },
        products: [...productShipping.entries()]
          .map(([productName, d]) => ({
            productName,
            orderCount: d.orderCount,
            totalEstimated: round(d.totalEstimated),
            totalActual: round(d.totalActual),
            avgDiscrepancy: d.orderCount > 0 ? round((d.totalActual - d.totalEstimated) / d.orderCount) : 0,
            discrepancyPct: d.totalEstimated > 0 ? round(((d.totalActual - d.totalEstimated) / d.totalEstimated) * 100) : 0,
            totalRevenue: round(d.totalRevenue),
            totalQuantity: d.totalQuantity,
          }))
          .sort((a, b) => Math.abs(b.avgDiscrepancy) - Math.abs(a.avgDiscrepancy)),
      }
    : undefined;

  const sellerIncome = totalSettlement;
  const margin = totalRevenue > 0 ? round((sellerIncome / totalRevenue) * 100) : 0;

  return {
    summary: {
      totalRevenue: round(totalRevenue),
      totalFees: round(totalFees),
      totalShipping: round(totalShipping),
      sellerIncome: round(sellerIncome),
      overallMargin: margin,
      totalOrders: records.length,
      avgOrderValue: records.length > 0 ? round(totalRevenue / records.length) : 0,
      avgFeePerOrder: records.length > 0 ? round(totalFees / records.length) : 0,
    },
    feeBreakdown,
    byProduct,
    shippingDiscrepancy,
    coverage: { state: "ready", basis: "imported-records", exclusions: ["COGS", "advertising", "payroll", "overhead"] },
    currency,
  };
}

// ── Shopify ─────────────────────────────────────────────────────────────────

async function getShopifyProfitDetail(
  ownerIds: string[],
  shopIds: string[],
  range?: { gte?: Date; lte?: Date },
): Promise<ProfitDetailResponse> {
  const orders = await prisma.shopifyOrder.findMany({
    where: { shopId: { in: shopIds }, test: false, ...fallbackDateFilter("shopifyCreatedAt", range) },
    include: { items: true },
  });

  const nonCancelled = orders.filter((o) => !o.orderStatus.toLowerCase().includes("cancelled"));
  const currency = orders[0]?.currency ?? "USD";

  let totalRevenue = 0;
  let totalShipping = 0;

  for (const o of nonCancelled) {
    totalRevenue += o.subtotalAmount;
    totalShipping += o.shippingAmount ?? 0;
  }

  const feeBreakdown: FeeBreakdownItem[] = totalShipping > 0
    ? [{ name: "Shipping Fee", amount: round(totalShipping), percentage: totalRevenue > 0 ? round((totalShipping / totalRevenue) * 100) : 0 }]
    : [];

  // Per-product aggregation with proportional shipping allocation
  const productMap = new Map<string, { revenue: number; quantity: number; orders: Set<string> }>();
  for (const o of nonCancelled) {
    for (const item of o.items) {
      const name = item.name || "Unknown Product";
      const existing = productMap.get(name) ?? { revenue: 0, quantity: 0, orders: new Set() };
      existing.revenue += (item.discountedPrice ?? item.price) * item.currentQuantity;
      existing.quantity += item.currentQuantity;
      existing.orders.add(o.id);
      productMap.set(name, existing);
    }
  }

  const feesByProduct = allocateFeesByRevenue(productMap, totalShipping);
  const byProduct: ProductProfitRow[] = [...productMap.entries()]
    .map(([name, p]) => {
      const fees = feesByProduct.get(name) ?? 0;
      const profit = round(p.revenue - fees);
      return {
        productName: name,
        revenue: round(p.revenue),
        quantitySold: p.quantity,
        orderCount: p.orders.size,
        estimatedFees: fees,
        estimatedProfit: profit,
        margin: p.revenue > 0 ? round((profit / p.revenue) * 100) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const sellerIncome = totalRevenue - totalShipping;
  const margin = totalRevenue > 0 ? round((sellerIncome / totalRevenue) * 100) : 0;

  return {
    summary: {
      totalRevenue: round(totalRevenue),
      totalFees: 0,
      totalShipping: round(totalShipping),
      sellerIncome: round(sellerIncome),
      overallMargin: margin,
      totalOrders: nonCancelled.length,
      avgOrderValue: nonCancelled.length > 0 ? round(totalRevenue / nonCancelled.length) : 0,
      avgFeePerOrder: 0,
    },
    feeBreakdown,
    byProduct,
    coverage: { state: "ready", basis: "order-estimate", exclusions: ["COGS", "advertising", "payroll", "overhead", "marketplace fees (none)"] },
    currency,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function getProfitDetail(
  platform: MarketplacePlatform,
  session: Session,
  params: URLSearchParams,
): Promise<ProfitDetailResponse> {
  const ownerIds = await marketplaceOwnerIds(session);
  const selectedShop = params.get("shopId");
  const accessibleShops = await accessibleMarketplaceShops(session, platform);
  const selectedShops = selectedShop
    ? accessibleShops.filter((shop) => shop.id === selectedShop)
    : accessibleShops;
  if (selectedShop && selectedShops.length === 0) {
    throw new Error("Selected shop is unavailable");
  }
  const shopIds = selectedShops.map((s) => s.id);
  if (shopIds.length === 0) {
    return {
      summary: { totalRevenue: 0, totalFees: 0, totalShipping: 0, sellerIncome: 0, overallMargin: 0, totalOrders: 0, avgOrderValue: 0, avgFeePerOrder: 0 },
      feeBreakdown: [],
      byProduct: [],
      coverage: { state: "unavailable", basis: "no shops", exclusions: [] },
      currency: "unknown",
    };
  }

  const range = parseAnalyticsDateRange(params);

  let result: ProfitDetailResponse;
  switch (platform) {
    case "shopee": result = await getShopeeProfitDetail(ownerIds, shopIds, range); break;
    case "lazada": result = await getLazadaProfitDetail(ownerIds, shopIds, range); break;
    case "tiktok": result = await getTikTokProfitDetail(ownerIds, shopIds, range); break;
    case "shopify": result = await getShopifyProfitDetail(ownerIds, shopIds, range); break;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }

  // Mark as provisional when finance is available but not yet reconciled
  const capabilities = await getMarketplaceCapabilities(platform, shopIds);
  const reconciled = await getMarketplaceFinancialReadiness(platform, shopIds);
  const financeReady = isFinancialAnalyticsEligible({ platform, shops: selectedShops, finance: capabilities.finance, readinessAndEvidenceApproved: reconciled });

  if (capabilities.finance === "available" && !financeReady) {
    result.coverage = { state: "provisional", basis: result.coverage.basis, exclusions: result.coverage.exclusions };
  }

  return result;
}
