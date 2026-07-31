import { isCertifiedQuality } from "./provenance";
import { canonicalizeStatus } from "./status";
import type { AnalyticsCoverage, BuyerMetrics, ClvMetrics, NormalizedOrderFinancials, ProfitSummary } from "./types";

export type ProvisionalFinancialRecord = {
  transactionType: string | null;
  feeType: string | null;
  amountMinor: string | null;
  amountScale: number;
  currency: string | null;
};

const round = (value: number) => Math.round(value * 100) / 100;
const financialFields = ["grossSales", "sellerDiscount", "refund", "buyerShippingCredit", "platformSubsidy", "marketplaceFees", "paymentFees", "sellerShipping", "returnShipping", "otherCharges"] as const;
type FinancialField = (typeof financialFields)[number];

export function isCancelled(status: string): boolean { return /cancel|fail/i.test(status); }
function eligible(order: NormalizedOrderFinancials) { return canonicalizeStatus(order.platform, order.status).certifiedFinanciallyEligible && isCertifiedQuality(order.financialQuality); }
function known(order: NormalizedOrderFinancials, field: FinancialField): number | null {
  const value = order[field];
  return eligible(order) && typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function calculateProfit(orders: NormalizedOrderFinancials[], reportingCurrency: string): ProfitSummary {
  const included = orders.filter(eligible);
  const missing = new Set<string>();
  const labels: Record<FinancialField, string> = { grossSales: "gross sales", sellerDiscount: "seller-funded discounts", refund: "refunds", buyerShippingCredit: "buyer-paid shipping credits", platformSubsidy: "platform subsidies", marketplaceFees: "marketplace fees", paymentFees: "payment and transaction fees", sellerShipping: "seller shipping charges", returnShipping: "return shipping charges", otherCharges: "other marketplace charges" };
  const totals = {} as Record<FinancialField, number | null>;
  for (const field of financialFields) {
    if (included.length === 0) { totals[field] = null; continue; }
    const values = included.map((order) => known(order, field));
    if (values.some((value) => value === null)) { totals[field] = null; missing.add(labels[field]); }
    else totals[field] = round((values as number[]).reduce((sum, value) => sum + value, 0));
  }
  if (included.length === 0) missing.add(orders.length ? "certified financial provenance" : "no orders");
  const netSales = totals.grossSales !== null && totals.sellerDiscount !== null && totals.refund !== null ? round(totals.grossSales - totals.sellerDiscount - totals.refund) : null;
  const costs = [totals.marketplaceFees, totals.paymentFees, totals.sellerShipping, totals.returnShipping, totals.otherCharges];
  const estimate = netSales !== null && totals.buyerShippingCredit !== null && totals.platformSubsidy !== null && costs.every((value) => value !== null) ? round(netSales + totals.buyerShippingCredit + totals.platformSubsidy - costs.reduce((sum, value) => sum + value!, 0)) : null;
  const settled = included.length > 0 && included.every((order) => order.settledProceedsVerified && typeof order.settledProceeds === "number");
  const settledProceeds = settled ? round(included.reduce((sum, order) => sum + order.settledProceeds!, 0)) : null;
  const certifiedFields = included.length * financialFields.length - [...missing].filter((label) => label !== "certified financial provenance" && label !== "no orders").length * included.length;
  const coverage: AnalyticsCoverage = { state: included.length === 0 ? "unavailable" : missing.size ? "partial" : "ready", calculationBasis: included.length === 0 ? "unavailable" : settled ? "settled" : missing.size ? "partial" : "order-estimate", financialCoveragePercent: included.length ? round((certifiedFields / (included.length * financialFields.length)) * 100) : null, buyerIdentityCoveragePercent: included.length ? round((included.filter((order) => order.buyerId).length / included.length) * 100) : 0, missingCostCategories: [...missing], reportingCurrency, conversion: { applied: false, sourceCurrencies: [...new Set(orders.map((order) => order.currency))] }, exclusions: ["COGS", "advertising spend", "payroll", "overhead", "tax pass-through amounts"], unavailableReasons: included.length ? [] : [...missing], rawOrderCount: orders.length, certifiedOrderCount: included.length };
  return { grossSales: totals.grossSales, sellerDiscounts: totals.sellerDiscount, refunds: totals.refund, netSales, buyerShippingCredits: totals.buyerShippingCredit, platformSubsidies: totals.platformSubsidy, marketplaceFees: totals.marketplaceFees, paymentFees: totals.paymentFees, sellerShipping: totals.sellerShipping, returnShipping: totals.returnShipping, otherCharges: totals.otherCharges, estimatedProfit: settledProceeds ?? estimate, estimatedMargin: netSales && (settledProceeds ?? estimate) !== null ? round(((settledProceeds ?? estimate)! / netSales) * 100) : null, orderCount: included.length, coverage };
}

export function calculateBuyerMetrics(orders: NormalizedOrderFinancials[]): BuyerMetrics {
  // Buyer identity supports operational counts independently of finance certification.
  const operational = orders.filter((order) => !isCancelled(order.status));
  if (operational.length === 0) return { uniqueBuyers: 0, repeatBuyers: 0, repeatPurchaseRate: 0, averageOrderValue: null, topBuyers: [], availabilityReason: null };
  if (operational.some((order) => !order.buyerId)) return { uniqueBuyers: null, repeatBuyers: null, repeatPurchaseRate: null, averageOrderValue: null, topBuyers: [], availabilityReason: "buyer_identity_unavailable" };
  const buyers = new Map<string, { orders: number; financialOrders: number; sales: number; displayName: string | null }>();
  for (const order of operational) {
    const buyer = buyers.get(order.buyerId!) ?? { orders: 0, financialOrders: 0, sales: 0, displayName: order.buyerDisplayName };
    buyer.orders++;
    if (known(order, "grossSales") !== null && known(order, "sellerDiscount") !== null && known(order, "refund") !== null) {
      buyer.financialOrders++;
      buyer.sales += order.grossSales! - order.sellerDiscount! - order.refund!;
    }
    buyers.set(order.buyerId!, buyer);
  }
  const values = [...buyers.values()]; const totalOrders = values.reduce((sum, buyer) => sum + buyer.orders, 0); const repeatBuyers = values.filter((buyer) => buyer.orders > 1).length;
  const financialValuesAvailable = values.every((buyer) => buyer.financialOrders === buyer.orders);
  return { uniqueBuyers: buyers.size, repeatBuyers, repeatPurchaseRate: buyers.size ? round(repeatBuyers / buyers.size * 100) : 0, averageOrderValue: financialValuesAvailable && totalOrders ? round(values.reduce((sum, buyer) => sum + buyer.sales, 0) / totalOrders) : null, topBuyers: values.map((buyer) => ({ displayName: buyer.displayName, orders: buyer.orders, sales: buyer.financialOrders === buyer.orders ? round(buyer.sales) : null, historicalNetSales: buyer.financialOrders === buyer.orders ? round(buyer.sales) : null })).sort((a, b) => b.orders - a.orders), availabilityReason: financialValuesAvailable ? null : "buyer_value_unavailable" };
}

export function calculateClvMetrics(orders: NormalizedOrderFinancials[]): ClvMetrics {
  const valid = orders.filter((order) => eligible(order) && order.buyerId && known(order, "grossSales") !== null && known(order, "sellerDiscount") !== null && known(order, "refund") !== null);
  const reference = valid.reduce((latest, order) => order.createdAt > latest ? order.createdAt : latest, new Date(0));
  const buyers = new Map<string, { orders: number; sales: number; lastOrder: Date; displayName: string | null }>();
  for (const order of valid) { const buyer = buyers.get(order.buyerId!) ?? { orders: 0, sales: 0, lastOrder: order.createdAt, displayName: order.buyerDisplayName }; buyer.orders++; buyer.sales += order.grossSales! - order.sellerDiscount! - order.refund!; if (order.createdAt > buyer.lastOrder) buyer.lastOrder = order.createdAt; buyers.set(order.buyerId!, buyer); }
  const segments = { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 }; const churnRisk = { high: 0, medium: 0, low: 0 };
  const rows = [...buyers.values()].map((buyer) => { const recencyDays = Math.max(0, Math.floor((reference.getTime() - buyer.lastOrder.getTime()) / 86_400_000)); const segment = recencyDays > 180 ? "lost" : recencyDays > 90 ? "atRisk" : buyer.orders >= 3 ? (recencyDays <= 30 ? "champions" : "loyal") : "potential"; segments[segment]++; churnRisk[recencyDays > 180 ? "high" : recencyDays > 90 ? "medium" : "low"]++; return { displayName: buyer.displayName ?? "Buyer", historicalNetSales: round(buyer.sales), predictedNetRevenueNext12Months: null, orderCount: buyer.orders, avgOrderValue: round(buyer.sales / buyer.orders), recencyDays, availabilityReason: "predictive_clv_not_validated" }; });
  const totalSales = rows.reduce((sum, row) => sum + row.historicalNetSales!, 0);
  return { summary: { totalBuyers: rows.length, historicalNetSales: rows.length ? round(totalSales) : null, predictedNetRevenueNext12Months: null, method: null, horizonMonths: null, availabilityReason: "predictive_clv_not_validated" }, segments, churnRisk, topBuyersByClv: rows.sort((a, b) => b.historicalNetSales! - a.historicalNetSales!).slice(0, 10) };
}

/**
 * Calculates provisional profit directly from imported marketplace financial records.
 * Used when finance capability is available but reconciliation is not yet approved.
 * Results are provisional and should be displayed with a warning badge.
 */
export function calculateProvisionalProfit(records: ProvisionalFinancialRecord[], reportingCurrency: string, rawOrderCount: number): ProfitSummary {
  if (records.length === 0) {
    return {
      grossSales: null, sellerDiscounts: null, refunds: null, netSales: null,
      buyerShippingCredits: null, platformSubsidies: null, marketplaceFees: null,
      paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null,
      estimatedProfit: null, estimatedMargin: null, orderCount: 0,
      coverage: {
        state: "unavailable", calculationBasis: "unavailable",
        financialCoveragePercent: null, buyerIdentityCoveragePercent: 0,
        missingCostCategories: ["no imported records"], reportingCurrency,
        conversion: { applied: false, sourceCurrencies: [] },
        exclusions: ["COGS", "advertising spend", "payroll", "overhead", "tax pass-through amounts"],
        unavailableReasons: ["no imported records"], rawOrderCount: 0, certifiedOrderCount: 0,
      },
    };
  }

  let grossSales = 0;
  let marketplaceFees = 0;
  let paymentFees = 0;
  let sellerShipping = 0;
  let refunds = 0;
  let otherCharges = 0;
  let buyerShippingCredits = 0;

  for (const record of records) {
    const amount = record.amountMinor ? Number(record.amountMinor) / Math.pow(10, record.amountScale) : 0;
    if (!Number.isFinite(amount)) continue;
    const type = (record.transactionType ?? record.feeType ?? "").toLowerCase();
    if (type.includes("sales") || type.includes("sale")) {
      if (amount < 0) refunds += Math.abs(amount);
      else grossSales += amount;
    } else if (type.includes("logistics") || type.includes("shipping")) {
      if (amount < 0) sellerShipping += amount;
      else buyerShippingCredits += amount;
    } else if (type.includes("fee")) {
      marketplaceFees += amount;
    } else if (type.includes("refund")) {
      refunds += Math.abs(amount);
    } else {
      otherCharges += amount;
    }
  }

  const netSales = round(grossSales - refunds);
  const costs = Math.abs(marketplaceFees) + Math.abs(paymentFees) + Math.abs(sellerShipping) + Math.abs(otherCharges);
  const estimate = round(netSales + buyerShippingCredits - costs);
  const coverage: AnalyticsCoverage = {
    state: "provisional", calculationBasis: "imported-records",
    financialCoveragePercent: null, buyerIdentityCoveragePercent: 0,
    missingCostCategories: [], reportingCurrency,
    conversion: { applied: false, sourceCurrencies: [reportingCurrency] },
    exclusions: ["COGS", "advertising spend", "payroll", "overhead", "tax pass-through amounts"],
    unavailableReasons: [], rawOrderCount, certifiedOrderCount: 0,
  };
  return {
    grossSales: round(grossSales), sellerDiscounts: null, refunds: round(refunds), netSales,
    buyerShippingCredits: round(buyerShippingCredits), platformSubsidies: null,
    marketplaceFees: round(marketplaceFees), paymentFees: round(paymentFees),
    sellerShipping: round(sellerShipping), returnShipping: null, otherCharges: round(otherCharges),
    estimatedProfit: estimate, estimatedMargin: netSales ? round((estimate / netSales) * 100) : null,
    orderCount: 0, coverage,
  };
}

/**
 * Calculates provisional profit directly from order-level financial fields,
 * bypassing the certified-quality gate. Used for platforms where the order
 * rows already carry escrow/finance breakdown (Shopee, TikTok, Shopify).
 */
export function calculateProvisionalProfitFromOrders(orders: NormalizedOrderFinancials[], reportingCurrency: string): ProfitSummary {
  const operational = orders.filter((order) => !isCancelled(order.status));
  if (operational.length === 0) {
    return {
      grossSales: null, sellerDiscounts: null, refunds: null, netSales: null,
      buyerShippingCredits: null, platformSubsidies: null, marketplaceFees: null,
      paymentFees: null, sellerShipping: null, returnShipping: null, otherCharges: null,
      estimatedProfit: null, estimatedMargin: null, orderCount: 0,
      coverage: {
        state: "unavailable", calculationBasis: "unavailable",
        financialCoveragePercent: null, buyerIdentityCoveragePercent: 0,
        missingCostCategories: ["no operational orders"], reportingCurrency,
        conversion: { applied: false, sourceCurrencies: [] },
        exclusions: ["COGS", "advertising spend", "payroll", "overhead", "tax pass-through amounts"],
        unavailableReasons: ["no operational orders"], rawOrderCount: orders.length, certifiedOrderCount: 0,
      },
    };
  }

  const financialFields = ["grossSales", "sellerDiscount", "refund", "buyerShippingCredit", "platformSubsidy", "marketplaceFees", "paymentFees", "sellerShipping", "returnShipping", "otherCharges"] as const;
  type FinancialField = (typeof financialFields)[number];
  const totals = {} as Record<FinancialField, number | null>;
  const missing = new Set<string>();
  const labels: Record<FinancialField, string> = { grossSales: "gross sales", sellerDiscount: "seller-funded discounts", refund: "refunds", buyerShippingCredit: "buyer-paid shipping credits", platformSubsidy: "platform subsidies", marketplaceFees: "marketplace fees", paymentFees: "payment and transaction fees", sellerShipping: "seller shipping charges", returnShipping: "return shipping charges", otherCharges: "other marketplace charges" };

  for (const field of financialFields) {
    const knownValues = operational.map((order) => order[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (knownValues.length > 0) {
      totals[field] = round(knownValues.reduce((sum, v) => sum + v, 0));
      if (knownValues.length < operational.length) missing.add(labels[field]);
    } else {
      totals[field] = null;
      missing.add(labels[field]);
    }
  }

  const netSales = totals.grossSales !== null ? round(totals.grossSales - (totals.sellerDiscount ?? 0) - (totals.refund ?? 0)) : null;
  const knownCosts = [totals.marketplaceFees, totals.paymentFees, totals.sellerShipping, totals.returnShipping, totals.otherCharges].filter((v): v is number => v !== null);
  const totalCosts = knownCosts.length > 0 ? round(knownCosts.reduce((sum, v) => sum + v, 0)) : null;
  const estimate = netSales !== null && totalCosts !== null ? round(netSales + (totals.buyerShippingCredit ?? 0) + (totals.platformSubsidy ?? 0) - Math.abs(totalCosts)) : null;

  const coverage: AnalyticsCoverage = {
    state: "provisional", calculationBasis: "imported-records",
    financialCoveragePercent: null, buyerIdentityCoveragePercent: 0,
    missingCostCategories: [...missing], reportingCurrency,
    conversion: { applied: false, sourceCurrencies: [reportingCurrency] },
    exclusions: ["COGS", "advertising spend", "payroll", "overhead", "tax pass-through amounts"],
    unavailableReasons: [], rawOrderCount: orders.length, certifiedOrderCount: 0,
  };

  return {
    grossSales: totals.grossSales, sellerDiscounts: totals.sellerDiscount, refunds: totals.refund, netSales,
    buyerShippingCredits: totals.buyerShippingCredit, platformSubsidies: totals.platformSubsidy,
    marketplaceFees: totals.marketplaceFees, paymentFees: totals.paymentFees,
    sellerShipping: totals.sellerShipping, returnShipping: totals.returnShipping, otherCharges: totals.otherCharges,
    estimatedProfit: estimate, estimatedMargin: netSales && estimate !== null ? round((estimate / netSales) * 100) : null,
    orderCount: operational.length, coverage,
  };
}
