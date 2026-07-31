import { getMarketplaceCapabilities, getMarketplaceFinancialReadiness } from "./capabilities";
import { isCertifiedQuality } from "./provenance";
import type { MarketplacePlatform } from "./types";

type LegacyFinancialRow = { financialQuality?: string | null };

/** Legacy endpoints may expose a value only after capability, reconciliation, and row provenance agree. */
export async function legacyFinancialReady(platform: MarketplacePlatform, shopIds: string[], capability: "finance" | "refunds" = "finance") {
  const capabilities = await getMarketplaceCapabilities(platform, shopIds);
  return capabilities.finance === "available" && capabilities[capability] === "available" && await getMarketplaceFinancialReadiness(platform, shopIds);
}

export function legacyKnownNumber(value: unknown, row: LegacyFinancialRow | undefined, ready: boolean): number | null {
  return ready && isCertifiedQuality(row?.financialQuality as Parameters<typeof isCertifiedQuality>[0]) && typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Operational dashboards retain observed marketplace values while finance stays provenance-gated. */
export function legacyOperationalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function legacySum(rows: Array<LegacyFinancialRow & { value: unknown }>, ready: boolean): number | null {
  if (rows.length === 0) return 0;
  const values = rows.map((row) => legacyKnownNumber(row.value, row, ready));
  return values.some((value) => value === null) ? null : (values as number[]).reduce((sum, value) => sum + value, 0);
}

export function legacyOperationalSum(rows: Array<{ value: unknown }>): number | null {
  if (rows.length === 0) return 0;
  const values = rows.map((row) => legacyOperationalNumber(row.value));
  return values.some((value) => value === null) ? null : (values as number[]).reduce((sum, value) => sum + value, 0);
}
