import type { ProductProfitRow, ProfitDetailResponse } from "@/lib/marketplace/analytics/profit-detail";

export type LazadaFinancialRow = {
  shopId: string;
  amountMinor: string | null;
  amountScale: number;
  currency: string | null;
  feeName: string | null;
  transactionType: string | null;
  orderExternalId: string | null;
  itemExternalId: string | null;
  financialQuality?: string | null;
};

export type LazadaReportOrder = {
  id: string;
  shopId: string;
  lazadaOrderId: string;
  orderStatus: string;
  currency: string | null;
  items: Array<{
    id: string;
    lazadaOrderItemId: number;
    itemId: number | null;
    skuId: string | null;
    sellerSku: string | null;
    shopSku: string | null;
    productName: string;
    paidPrice: number | null;
    quantity: number | null;
  }>;
};

type Category = "sales" | "refunds" | "discounts" | "fees" | "shipping";
const feeCategories: Record<string, Category> = {
  "item price credit": "sales",
  "reversal item price": "refunds",
  "lazcoins discount": "discounts",
  "reversal of lazcoins discount": "discounts",
  commission: "fees",
  "reversal commission": "fees",
  "payment fee": "fees",
  "payment fee credit": "fees",
  "lazcoins discount promotion fee": "fees",
  "sponsored affiliates": "fees",
  "sponsored affiliates refund": "fees",
  "shipping fee subsidy (by seller)": "shipping",
  "wrong weight adjustment": "shipping",
  "wrong shipping fee adjustment": "shipping",
};

export function lazadaFeeCategory(row: Pick<LazadaFinancialRow, "feeName" | "transactionType">): Category | null {
  // Exact source names, not substring or sign-based guesses. New regional names
  // remain unclassified until their accounting meaning is established.
  return feeCategories[(row.feeName?.trim() || row.transactionType?.trim() || "").toLowerCase()] ?? null;
}

const diagnosticTypes = new Set(["logistics_fee", "shipping_fee_comparison", "payout_statement"]);
const validMoney = (row: LazadaFinancialRow) => typeof row.amountMinor === "string" && /^-?\d+$/.test(row.amountMinor)
  && Number.isInteger(row.amountScale) && row.amountScale >= 0 && row.amountScale <= 12;
const validCurrency = (currency: string | null) => /^[A-Z]{3}$/.test(currency ?? "");

/** Scale alignment is exact. Never silently round large values into a JS number. */
export function sumLazadaMoney(rows: readonly LazadaFinancialRow[]): number | null {
  if (!rows.length || rows.some((row) => !validMoney(row) || !/^[A-Z]{3}$/.test(row.currency ?? ""))) return null;
  if (new Set(rows.map((row) => row.currency)).size !== 1) return null;
  const scale = Math.max(...rows.map((row) => row.amountScale));
  const minor = rows.reduce((sum, row) => sum + BigInt(row.amountMinor!) * 10n ** BigInt(scale - row.amountScale), 0n);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minor) / 10 ** scale;
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildLazadaProfitReport(records: readonly LazadaFinancialRow[], orders: readonly LazadaReportOrder[], financeReady = false): ProfitDetailResponse {
  const ledger = records.filter((row) => !diagnosticTypes.has((row.transactionType ?? "").toLowerCase()));
  const currencies = [...new Set(ledger.map((row) => row.currency).filter((value): value is string => validCurrency(value)))];
  // An order's denomination is evidence for its merchandise, not for a finance
  // posting whose provider omitted currency. Keep those source bases separate.
  const currency = currencies.length === 1 ? currencies[0]! : "unknown";
  const reasons = [
    ...(!ledger.length ? ["no imported Lazada transaction records"] : []),
    ...(ledger.some((row) => !validMoney(row)) ? ["some transaction amounts or scales are missing or invalid"] : []),
    ...(ledger.some((row) => !/^[A-Z]{3}$/.test(row.currency ?? "")) ? ["transaction currency provenance is missing or invalid"] : []),
    ...(currencies.length > 1 ? ["mixed transaction currencies cannot be aggregated"] : []),
    ...(ledger.some((row) => !lazadaFeeCategory(row)) ? ["some transaction categories are unmapped"] : []),
    ...(ledger.length && sumLazadaMoney(ledger) === null ? ["the signed ledger total cannot be represented with known currency and exact safe precision"] : []),
    ...(!financeReady ? ["financial history and reconciliation are not independently verified"] : []),
    ...(ledger.some((row) => !["verified", "derived"].includes(row.financialQuality ?? "")) ? ["some transaction provenance is unverified"] : []),
  ];
  const complete = ledger.length > 0 && reasons.length === 0;
  const categoryRows = (category: Category) => ledger.filter((row) => lazadaFeeCategory(row) === category);
  const total = (category: Category) => {
    if (ledger.some((row) => !validMoney(row) || !lazadaFeeCategory(row) || row.currency !== currency)) return null;
    const rows = categoryRows(category);
    // Absence establishes zero only for independently complete financial history.
    return rows.length ? sumLazadaMoney(rows) : complete ? 0 : null;
  };
  const sales = total("sales");
  const refundPostings = total("refunds"), discountPostings = total("discounts");
  const feePostings = total("fees"), shippingPostings = total("shipping");
  const refunds = refundPostings === null ? null : -refundPostings;
  const discounts = discountPostings === null ? null : -discountPostings;
  const totalFees = feePostings === null ? null : -feePostings;
  const totalShipping = shippingPostings === null ? null : -shippingPostings;
  const observedLedgerNet = sumLazadaMoney(ledger);
  const sellerIncome = complete ? observedLedgerNet : null;

  const nonCancelled = orders.filter((order) => !/cancel|fail/i.test(order.orderStatus));
  type Product = { row: ProductProfitRow; amounts: Array<number | null>; quantities: Array<number | null>; currencies: Set<string | null>; orders: Set<string>; records: LazadaFinancialRow[] };
  const products = new Map<string, Product>();
  const lineProducts = new Map<string, string>();
  for (const order of nonCancelled) for (const item of order.items) {
    const sku = item.sellerSku ?? item.shopSku;
    const key = item.skuId ? `${order.shopId}:variant:${item.skuId}`
      : sku ? `${order.shopId}:sku:${sku}`
        : item.itemId !== null ? `${order.shopId}:item:${item.itemId}` : `${order.shopId}:line:${item.lazadaOrderItemId}`;
    const product = products.get(key) ?? {
      row: { productName: item.productName, productId: item.itemId?.toString() ?? null, variantId: item.skuId, sku, sourceProductKey: key,
        revenue: null, revenueBasis: "paid_line_amount", quantitySold: null, quantitySourceConfidence: "partial", orderCount: 0, estimatedFees: null, estimatedProfit: null, margin: null },
      amounts: [], quantities: [], currencies: new Set<string | null>(), orders: new Set<string>(), records: [],
    };
    product.amounts.push(item.paidPrice);
    product.quantities.push(item.quantity);
    product.currencies.add(order.currency);
    product.orders.add(order.id);
    products.set(key, product);
    lineProducts.set(`${order.shopId}:${order.lazadaOrderId}:${item.lazadaOrderItemId}`, key);
  }
  const unallocated: LazadaFinancialRow[] = [];
  for (const row of ledger) {
    const key = row.orderExternalId && row.itemExternalId ? lineProducts.get(`${row.shopId}:${row.orderExternalId}:${row.itemExternalId}`) : undefined;
    if (key) products.get(key)!.records.push(row);
    else unallocated.push(row);
  }
  const byProduct = [...products.values()].map((product) => {
    const knownAmounts = product.amounts.every((value) => typeof value === "number" && Number.isFinite(value));
    const knownQuantities = product.quantities.every((value) => typeof value === "number" && Number.isFinite(value));
    const revenueCurrency = product.currencies.size === 1 && validCurrency([...product.currencies][0]!) ? [...product.currencies][0]! : null;
    const paid = knownAmounts && revenueCurrency ? round((product.amounts as number[]).reduce((sum, value) => sum + value, 0)) : null;
    const ownFees = product.records.filter((row) => ["fees", "shipping"].includes(lazadaFeeCategory(row) ?? ""));
    const fees = complete && unallocated.length === 0 && product.records.length ? (ownFees.length ? sumLazadaMoney(ownFees) : 0) : null;
    const proceeds = complete && unallocated.length === 0 ? sumLazadaMoney(product.records) : null;
    return { ...product.row, revenue: paid, revenueCurrency, quantitySold: knownQuantities ? (product.quantities as number[]).reduce((sum, value) => sum + value, 0) : null,
      quantitySourceConfidence: knownQuantities ? "observed" as const : "partial" as const, orderCount: product.orders.size,
      estimatedFees: fees === null ? null : -fees, estimatedProfit: proceeds,
      // Paid merchandise and gross ledger credits have different discount bases.
      // Do not derive a product margin by dividing one by the other.
      margin: null };
  }).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity));

  const byName = new Map<string, LazadaFinancialRow[]>();
  for (const row of ledger) if (["fees", "shipping"].includes(lazadaFeeCategory(row) ?? "")) {
    const name = row.feeName || row.transactionType!;
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }
  const feeBreakdown = [...byName].flatMap(([name, rows]) => {
    if (rows.some((row) => row.currency !== currency)) return [];
    const amount = sumLazadaMoney(rows);
    return amount === null ? [] : [{ name, amount: -amount, percentage: sales !== null && sales > 0 ? round(-amount / sales * 100) : 0 }];
  });
  const knownRecords = ledger.filter((row) => validMoney(row) && /^[A-Z]{3}$/.test(row.currency ?? "") && row.currency === currency);
  const amountRecords = ledger.filter(validMoney);
  const currencyRecords = ledger.filter((row) => validCurrency(row.currency));
  const classifiedRecords = ledger.filter((row) => lazadaFeeCategory(row) !== null);
  return {
    summary: { totalRevenue: sales, totalFees, totalShipping, sellerIncome,
      overallMargin: sales !== null && sales > 0 && sellerIncome !== null ? round(sellerIncome / sales * 100) : null,
      totalOrders: nonCancelled.length, avgOrderValue: sales !== null && nonCancelled.length ? round(sales / nonCancelled.length) : null,
      avgFeePerOrder: totalFees !== null && nonCancelled.length ? round(totalFees / nonCancelled.length) : null,
      refunds, sellerDiscounts: discounts, observedLedgerNet, unallocatedLedgerNet: sumLazadaMoney(unallocated), unallocatedRecordCount: unallocated.length },
    byProduct, feeBreakdown, currency,
    coverage: { state: !knownRecords.length ? "unavailable" : complete ? "ready" : "provisional", basis: "imported-records",
      sourceQualityBasis: "signed Lazada transaction postings; product revenue is paid merchandise excluding shipping",
      provisional: knownRecords.length > 0 && !complete, exclusions: ["COGS", "advertising outside imported postings", "payroll", "overhead"],
      fieldCoverage: { transactionAmounts: { known: amountRecords.length, missing: ledger.length - amountRecords.length },
        transactionCurrencies: { known: currencyRecords.length, missing: ledger.length - currencyRecords.length },
        transactionCategories: { known: classifiedRecords.length, missing: ledger.length - classifiedRecords.length },
        quantity: { known: nonCancelled.flatMap((order) => order.items).filter((item) => item.quantity !== null).length, missing: nonCancelled.flatMap((order) => order.items).filter((item) => item.quantity === null).length } },
      missingCostCategories: ["fees", "shipping"].filter((category) => !categoryRows(category as Category).length && !complete),
      unavailableReasons: reasons,
      dateBasis: { field: "Lazada order creation cohort; linked financial postings across occurrence dates", from: null, to: null, appliedFrom: null, appliedTo: null } },
  };
}
