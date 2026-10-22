/** Presence-aware Shopee order-line prices shared by live reads and ingestion. */
export function shopeeOrderItemAmounts(item: Record<string, unknown>) {
  const number = (value: unknown): number | null => {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const rawQuantity = number(item.model_quantity_purchased) ?? number(item.quantity);
  const quantity = rawQuantity !== null && Number.isSafeInteger(rawQuantity) ? rawQuantity : null;
  const originalUnitPrice = number(item.model_original_price);
  const discountedUnitPrice = number(item.model_discounted_price);
  // A genuine zero discount price is a free line, never a reason to use list price.
  const unitPrice = discountedUnitPrice ?? originalUnitPrice;
  const subtotal = quantity !== null && unitPrice !== null ? quantity * unitPrice : null;
  return {
    quantity,
    originalUnitPrice,
    unitPrice,
    unitPriceBasis: discountedUnitPrice !== null ? "discounted_unit_price" : originalUnitPrice !== null ? "original_unit_price" : "unavailable",
    subtotal: subtotal !== null && Number.isFinite(subtotal) ? subtotal : null,
  };
}
