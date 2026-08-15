// Shopee item/model IDs exceed signed 32-bit integers in current live data.
// They are later matched to Prisma numeric fields, so retain only JavaScript's
// safe-integer ceiling rather than imposing an obsolete Int32 API limit.
const SHOPEE_SAFE_INT_MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** Converts a decimal Shopee API identity to the form emitted by analytics. */
export function normalizeShopeeExternalId(value: string) {
  if (!/^\d+$/.test(value))
    throw new Error("Shopee external IDs must be decimal integers.");
  const normalized = BigInt(value).toString();
  if (BigInt(normalized) > SHOPEE_SAFE_INT_MAX)
    throw new Error("Shopee external ID is outside the supported range.");
  return normalized;
}
