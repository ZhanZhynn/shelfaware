import { lazadaSourceMoney, sumLazadaSourceMoney } from "./money";

type SourceLine = { externalLineId: string; paidPrice: number | null; quantity: number | null };

/** Only curated order facts, never raw provider payloads or settlement fields. */
export function lazadaOrderFacts(totalAmount: number | null, shippingAmount: number | null, items: readonly SourceLine[] | null, source: unknown) {
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source as Record<string, unknown> : {};
  const uniqueItems = items && new Set(items.map((item) => item.externalLineId)).size === items.length;
  const paidMerchandiseAmount = uniqueItems ? sumLazadaSourceMoney(items.map((item) => item.paidPrice)) : null;
  const knownQuantity = uniqueItems && items.length > 0 && items.every((item) => item.quantity !== null && Number.isSafeInteger(item.quantity) && item.quantity >= 0);
  return {
    amountBasis: "gross_merchandise",
    grossMerchandiseAmount: totalAmount,
    paidMerchandiseAmount,
    buyerShippingAmount: shippingAmount,
    buyerPaidTotalAmount: sumLazadaSourceMoney([paidMerchandiseAmount, shippingAmount]),
    sellerDiscountAmount: lazadaSourceMoney(raw.voucher_seller),
    platformDiscountAmount: lazadaSourceMoney(raw.voucher_platform),
    itemRowCount: uniqueItems ? items.length : null,
    unitQuantity: knownQuantity ? items.reduce((sum, item) => sum + item.quantity!, 0) : null,
    quantityBasis: knownQuantity ? "provider_quantity" : "unverified_item_row_unit_semantics",
    sourceStatuses: Array.isArray(raw.statuses) ? raw.statuses.filter((status): status is string => typeof status === "string" && status.length <= 80) : [],
  };
}
