const SHOPEE_INT_MAX = 2_147_483_647n;

/** Converts a decimal Shopee API identity to the form emitted by analytics. */
export function normalizeShopeeExternalId(value: string) {
  if (!/^\d+$/.test(value))
    throw new Error("Shopee external IDs must be decimal integers.");
  const normalized = BigInt(value).toString();
  if (BigInt(normalized) > SHOPEE_INT_MAX)
    throw new Error("Shopee external ID is outside the supported range.");
  return normalized;
}
