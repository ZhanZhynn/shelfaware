import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceCapabilities, getMarketplaceFinancialReadiness } from "./capabilities";
import { AnalyticsValidationError, isFinancialAnalyticsEligible, parseAnalyticsDateRange } from "./server";
import type { MarketplacePlatform } from "./types";
import { getShopeeRefundEvidence } from "./refund-evidence";
import { buildLazadaProfitReport } from "@/lib/lazada/financial-report";
import { getMarketplaceReconciliationStatus } from "./reconciliation-status";

// ── Response types ──────────────────────────────────────────────────────────

export type ProfitDetailSummary = {
  totalRevenue: number | null;
  totalFees: number | null;
  totalShipping: number | null;
  sellerIncome: number | null;
  overallMargin: number | null;
  totalOrders: number;
  avgOrderValue: number | null;
  avgFeePerOrder: number | null;
  refunds?: number | null;
  sellerDiscounts?: number | null;
  observedLedgerNet?: number | null;
  unallocatedLedgerNet?: number | null;
  unallocatedRecordCount?: number;
};

export type FeeBreakdownItem = {
  name: string;
  amount: number;
  percentage: number;
};

export type ProductProfitRow = {
  productName: string;
  productId?: string | null;
  variantId?: string | null;
  sku?: string | null;
  sourceProductKey?: string;
  // This is only populated where a paid line amount is explicitly available.
  revenue: number | null;
  revenueCurrency?: string | null;
  revenueBasis?: "item_source_subtotal" | "paid_line_amount";
  itemSourceSubtotal?: number | null;
  quantitySold: number | null;
  quantitySourceConfidence?: "observed" | "partial";
  orderCount: number;
  estimatedFees: number | null;
  estimatedProfit: number | null;
  margin: number | null;
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
  coverage: {
    state: "ready" | "provisional" | "unavailable";
    basis: string;
    exclusions: string[];
    provisional: boolean;
    sourceQualityBasis: string;
    fieldCoverage: Record<string, { known: number; missing: number }>;
    missingCostCategories: string[];
    unavailableReasons: string[];
    dateBasis: { field: string; from: string | null; to: string | null; appliedFrom: string | null; appliedTo: string | null; ledgerFrom?: string | null; ledgerTo?: string | null };
  };
  currency: string;
  refundEvidence?: Awaited<ReturnType<typeof getShopeeRefundEvidence>>;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const round = (v: number) => Math.round(v * 100) / 100;
const standardExclusions = ["COGS", "advertising", "payroll", "overhead"];

type Session = Parameters<typeof marketplaceOwnerIds>[0];

function fallbackDateFilter(field: string, range?: { gte?: Date; lte?: Date }) {
  return range ? { OR: [{ [field]: range }, { [field]: null, createdAt: range }] } : {};
}

function profitCoverage(
  state: "ready" | "provisional" | "unavailable",
  basis: string,
  sourceQualityBasis: string,
  fieldCoverage: Record<string, { known: number; missing: number }> = {},
  missingCostCategories: string[] = [],
  unavailableReasons: string[] = [],
): ProfitDetailResponse["coverage"] {
  return {
    state,
    basis,
    exclusions: standardExclusions,
    provisional: state === "provisional",
    sourceQualityBasis,
    fieldCoverage,
    missingCostCategories,
    unavailableReasons,
    dateBasis: { field: "source order timestamp", from: null, to: null, appliedFrom: null, appliedTo: null },
  };
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
  const refundEvidence = await getShopeeRefundEvidence(orders);
  const currency = orders[0]?.currency ?? "MYR";

  const isKnownMoney = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
  const sumIfComplete = (values: Array<number | null | undefined>) => values.length > 0 && values.every(isKnownMoney)
    ? round((values as number[]).reduce((sum, value) => sum + value, 0))
    : null;
  const fieldValues = {
    totalRevenue: nonCancelled.map((order) => order.totalAmount),
    commissionFee: nonCancelled.map((order) => order.commissionFee),
    serviceFee: nonCancelled.map((order) => order.serviceFee),
    sellerTxnFee: nonCancelled.map((order) => order.sellerTxnFee),
    shippingFee: nonCancelled.map((order) => order.shippingFee),
    sellerIncome: nonCancelled.map((order) => order.sellerIncome),
  };
  const fieldCoverage = Object.fromEntries(Object.entries(fieldValues).map(([field, values]) => [field, {
    known: values.filter(isKnownMoney).length,
    missing: values.filter((value) => !isKnownMoney(value)).length,
  }]));
  const totalRevenue = sumIfComplete(fieldValues.totalRevenue);
  const totalCommission = sumIfComplete(fieldValues.commissionFee);
  const totalServiceFee = sumIfComplete(fieldValues.serviceFee);
  const totalSellerTxnFee = sumIfComplete(fieldValues.sellerTxnFee);
  const totalShipping = sumIfComplete(fieldValues.shippingFee);
  // Escrow income is a source fact. Never recreate it from partially observed fees.
  const sellerIncome = sumIfComplete(fieldValues.sellerIncome);
  const totalFees = totalCommission !== null && totalServiceFee !== null && totalSellerTxnFee !== null
    ? round(totalCommission + totalServiceFee + totalSellerTxnFee)
    : null;
  const hasFinancialEvidence = Object.values(fieldValues).some((values) => values.some(isKnownMoney));
  const allFieldsComplete = Object.values(fieldCoverage).every(({ missing }) => missing === 0);
  const allFinancialQualityVerified = nonCancelled.length > 0 && nonCancelled.every((order) => order.financialQuality === "verified");
  const missingCostCategories = (Object.entries({
    "Commission Fee": fieldCoverage.commissionFee,
    "Service Fee": fieldCoverage.serviceFee,
    "Seller Transaction Fee": fieldCoverage.sellerTxnFee,
    "Shipping Fee": fieldCoverage.shippingFee,
  }) as Array<[string, { known: number; missing: number }]>)
    .filter(([, coverage]) => coverage.missing > 0)
    .map(([name]) => name);
  const coverageState = !hasFinancialEvidence ? "unavailable" : allFieldsComplete && allFinancialQualityVerified ? "ready" : "provisional";
  const sourceQualityBasis = allFinancialQualityVerified
    ? "all included Shopee orders have verified financial provenance"
    : "Shopee order monetary fields are observed but not fully verified";

  // Fee breakdown
  const feeBreakdown: FeeBreakdownItem[] = [
    totalCommission === null ? null : { name: "Commission Fee", amount: totalCommission, percentage: totalRevenue !== null && totalRevenue > 0 ? round((totalCommission / totalRevenue) * 100) : 0 },
    totalServiceFee === null ? null : { name: "Service Fee", amount: totalServiceFee, percentage: totalRevenue !== null && totalRevenue > 0 ? round((totalServiceFee / totalRevenue) * 100) : 0 },
    totalSellerTxnFee === null ? null : { name: "Seller Transaction Fee", amount: totalSellerTxnFee, percentage: totalRevenue !== null && totalRevenue > 0 ? round((totalSellerTxnFee / totalRevenue) * 100) : 0 },
    totalShipping === null ? null : { name: "Shipping Fee", amount: totalShipping, percentage: totalRevenue !== null && totalRevenue > 0 ? round((totalShipping / totalRevenue) * 100) : 0 },
  ].filter((fee): fee is FeeBreakdownItem => fee !== null && fee.amount !== 0);

  // Item subtotals are list/source values, not verified paid line amounts. Keep them
  // separate and do not allocate order revenue, fees, or profit to product rows.
  const productMap = new Map<string, { productName: string; productId: string | null; variantId: string | null; sku: string | null; sourceSubtotal: number; sourceSubtotalMissing: boolean; quantity: number; quantityMissing: boolean; orders: Set<string> }>();
  for (const o of nonCancelled) {
    for (const item of o.items) {
      const sourceProductKey = item.variantId
        ? `${o.shopId}:variant:${item.variantId}`
        : item.shopeeItemId != null
          ? `${o.shopId}:shopee-item:${item.shopeeItemId}:${item.shopeeModelId ?? "base"}`
          : item.sku
            ? `${o.shopId}:sku:${item.sku}`
            : item.productId
              ? `${o.shopId}:product:${item.productId}`
              : `${o.shopId}:order-line:${o.id}:${item.id}`;
      const existing = productMap.get(sourceProductKey) ?? {
        productName: item.productName || "Unknown Product", productId: item.productId, variantId: item.variantId, sku: item.sku,
        sourceSubtotal: 0, sourceSubtotalMissing: false, quantity: 0, quantityMissing: false, orders: new Set<string>(),
      };
      if (isKnownMoney(item.subtotal)) existing.sourceSubtotal += item.subtotal;
      else existing.sourceSubtotalMissing = true;
      if (typeof item.quantity === "number" && Number.isFinite(item.quantity)) existing.quantity += item.quantity;
      else existing.quantityMissing = true;
      existing.orders.add(o.id);
      productMap.set(sourceProductKey, existing);
    }
  }

  const byProduct: ProductProfitRow[] = [...productMap.entries()]
    .map(([sourceProductKey, p]) => ({
        productName: p.productName,
        productId: p.productId,
        variantId: p.variantId,
        sku: p.sku,
        sourceProductKey,
        revenue: null,
        revenueBasis: "item_source_subtotal" as const,
        itemSourceSubtotal: p.sourceSubtotalMissing ? null : round(p.sourceSubtotal),
        quantitySold: p.quantityMissing ? null : p.quantity,
        quantitySourceConfidence: p.quantityMissing ? "partial" as const : "observed" as const,
        orderCount: p.orders.size,
        estimatedFees: null,
        estimatedProfit: null,
        margin: null,
    }))
    .sort((a, b) => (b.itemSourceSubtotal ?? -Infinity) - (a.itemSourceSubtotal ?? -Infinity));

  // Shipping discrepancy
  let ordersWithDiscrepancy = 0;
  let globalEstimated = 0;
  let globalActual = 0;
  let discrepancyOrders = 0;

  for (const o of nonCancelled) {
    const estimated = o.estimatedShippingFee;
    const actual = o.shippingFee;
    if (!isKnownMoney(estimated) || !isKnownMoney(actual)) continue;
    globalEstimated += estimated;
    globalActual += actual;
    discrepancyOrders++;
    const pct = estimated > 0 ? Math.abs((actual - estimated) / estimated) * 100 : 0;
    if (pct > 10) ordersWithDiscrepancy++;

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
        // No order shipping amount is allocated across multiple item lines.
        products: [],
      }
    : undefined;

  const margin = totalRevenue !== null && totalRevenue > 0 && sellerIncome !== null ? round((sellerIncome / totalRevenue) * 100) : null;
  return {
    summary: {
      totalRevenue,
      totalFees,
      totalShipping,
      sellerIncome,
      overallMargin: margin,
      totalOrders: nonCancelled.length,
      avgOrderValue: totalRevenue !== null && nonCancelled.length > 0 ? round(totalRevenue / nonCancelled.length) : null,
      avgFeePerOrder: totalFees !== null && nonCancelled.length > 0 ? round(totalFees / nonCancelled.length) : null,
    },
    feeBreakdown,
    byProduct,
    shippingDiscrepancy,
    refundEvidence,
    coverage: profitCoverage(
      coverageState,
      "Shopee order escrow fields; no paid-line allocation",
      sourceQualityBasis,
      fieldCoverage,
      missingCostCategories,
      hasFinancialEvidence ? [] : ["no Shopee monetary fields were observed for included orders"],
    ),
    currency,
  };
}

// ── Lazada ──────────────────────────────────────────────────────────────────

async function getLazadaProfitDetail(
  shopIds: string[],
  range?: { gte?: Date; lte?: Date },
  financeReady = false,
  dateBasis = "order-created",
  ledgerRange?: { gte?: Date; lte?: Date },
): Promise<ProfitDetailResponse> {
  if (dateBasis === "released") throw new AnalyticsValidationError("Lazada's transaction API has no verified release-date field; release-date reporting is unavailable.");
  if (!["order-created", "occurred"].includes(dateBasis)) throw new AnalyticsValidationError("Lazada profit dateBasis must be order-created or occurred");
  if (ledgerRange && dateBasis !== "order-created") throw new AnalyticsValidationError("Independent ledger dates require the order-created profit date basis");
  if (dateBasis === "occurred") {
    const records = await prisma.marketplaceFinancialRecord.findMany({
      where: { platform: "lazada", shopId: { in: shopIds }, ...(range ? { occurredAt: range } : {}) },
    });
    const orders = await prisma.lazadaOrder.findMany({ where: { OR: shopIds.map((shopId) => ({ shopId, lazadaOrderId: { in: records.filter((row) => row.shopId === shopId && row.orderExternalId).map((row) => row.orderExternalId!) } })) }, include: { items: true } });
    // A connection-level approval for another period is not evidence for this
    // requested occurrence interval. Both bounds and scoped certification matter.
    const scopes = financeReady && range?.gte && range.lte ? await Promise.all(shopIds.map((shopId) => getMarketplaceReconciliationStatus("lazada", shopId, new Date(), { dateBasis: "occurred", dateRange: range }))) : [];
    const scopedReady = scopes.length === shopIds.length && scopes.length > 0 && scopes.every((scope) => scope.certifiedReconciliationCount > 0 && scope.financialCoverage.state === "complete");
    return buildLazadaProfitReport(records, orders, scopedReady);
  }
  const orders = await prisma.lazadaOrder.findMany({ where: { shopId: { in: shopIds }, ...fallbackDateFilter("lazadaCreatedAt", range) }, include: { items: true } });
  const records = await prisma.marketplaceFinancialRecord.findMany({
    where: { platform: "lazada", ...(ledgerRange ? { occurredAt: ledgerRange } : {}), OR: shopIds.map((shopId) => ({ shopId, orderExternalId: { in: orders.filter((row) => row.shopId === shopId).map((row) => row.lazadaOrderId) } })) },
  });
  // An order-created subset is not a certified complete ledger interval. Keep its
  // observed posting sum available, but do not certify income from a shop flag.
  return buildLazadaProfitReport(records, orders, false);
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
    coverage: profitCoverage("ready", "imported-records", "imported marketplace financial records"),
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
    coverage: { ...profitCoverage("ready", "order-estimate", "Shopify order amounts"), exclusions: [...standardExclusions, "marketplace fees (none)"] },
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
      summary: { totalRevenue: null, totalFees: null, totalShipping: null, sellerIncome: null, overallMargin: null, totalOrders: 0, avgOrderValue: null, avgFeePerOrder: null },
      feeBreakdown: [],
      byProduct: [],
      coverage: { ...profitCoverage("unavailable", "no shops", "no accessible marketplace shops", {}, [], ["no accessible marketplace shops"]), exclusions: [] },
      currency: "unknown",
    };
  }

  const range = parseAnalyticsDateRange(params);
  const ledgerFrom = params.get("ledgerDateFrom"), ledgerTo = params.get("ledgerDateTo");
  if (Boolean(ledgerFrom) !== Boolean(ledgerTo)) throw new AnalyticsValidationError("ledgerDateFrom and ledgerDateTo must be provided together");
  if ((ledgerFrom || ledgerTo) && platform !== "lazada") throw new AnalyticsValidationError("Independent ledger dates are currently supported only for Lazada");
  const ledgerRange = ledgerFrom && ledgerTo ? parseAnalyticsDateRange(new URLSearchParams({ dateFrom: ledgerFrom, dateTo: ledgerTo })) : undefined;

  const capabilities = await getMarketplaceCapabilities(platform, shopIds);
  const reconciled = await getMarketplaceFinancialReadiness(platform, shopIds);
  const financeReady = isFinancialAnalyticsEligible({ platform, shops: selectedShops, finance: capabilities.finance, readinessAndEvidenceApproved: reconciled });

  let result: ProfitDetailResponse;
  switch (platform) {
    case "shopee": result = await getShopeeProfitDetail(ownerIds, shopIds, range); break;
    case "lazada": result = await getLazadaProfitDetail(shopIds, range, financeReady, params.get("dateBasis") ?? "order-created", ledgerRange); break;
    case "tiktok": result = await getTikTokProfitDetail(ownerIds, shopIds, range); break;
    case "shopify": result = await getShopifyProfitDetail(ownerIds, shopIds, range); break;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }

  // Mark as provisional when finance is available but not yet reconciled
  if (result.coverage.state !== "unavailable" && (result.coverage.provisional || !financeReady)) {
    result.coverage.state = "provisional";
    result.coverage.provisional = true;
  }

  const sourceDateField: Record<MarketplacePlatform, string> = {
    shopee: "shopeeCreatedAt (createdAt fallback)",
    lazada: params.get("dateBasis") === "occurred" ? "marketplace financial record occurredAt; linked orders across creation dates" : ledgerRange ? "lazadaCreatedAt (createdAt fallback); linked transactions within ledgerDateFrom/ledgerDateTo; unlinked adjustments excluded" : "lazadaCreatedAt (createdAt fallback); linked transactions across occurrence dates; unlinked adjustments excluded",
    tiktok: "marketplace financial record occurredAt",
    shopify: "shopifyCreatedAt (createdAt fallback)",
  };
  // Echo the exact filter strings, including an explicit UTC offset, alongside the
  // normalized database boundaries so downstream reports can reproduce the slice.
  result.coverage.dateBasis = {
    field: sourceDateField[platform],
    from: params.get("dateFrom"),
    to: params.get("dateTo"),
    appliedFrom: range?.gte?.toISOString() ?? null,
    appliedTo: range?.lte?.toISOString() ?? null,
    ...(platform === "lazada" ? { ledgerFrom, ledgerTo } : {}),
  };

  return result;
}
